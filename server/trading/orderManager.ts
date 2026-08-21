import Decimal from 'decimal.js';
import { Pool } from 'pg';
import { Order, Trade, Position } from './types';
import { getInstrumentConfig } from './instrumentConfig';
import { mapOrder, mapPosition } from './mappers';
import { lockMarginResources, calculateMargin } from './balanceManager';
import { recordPositionSnapshot } from './positionManager';
import * as crypto from 'crypto';

export async function getUserOrders(pool: Pool, userId: string): Promise<Order[]> {
  const res = await pool.query(
    'SELECT * FROM te_orders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return res.rows.map((r) => mapOrder(r));
}

export async function getActiveOrders(pool: Pool, instrumentKey: string): Promise<Order[]> {
  const res = await pool.query(
    "SELECT * FROM te_orders WHERE instrument_key = $1 AND status IN ('Open', 'PartiallyFilled') ORDER BY created_at ASC",
    [instrumentKey]
  );
  return res.rows.map((r) => mapOrder(r));
}

export async function getOrder(pool: Pool, orderId: string): Promise<Order | undefined> {
  const res = await pool.query('SELECT * FROM te_orders WHERE order_id = $1', [orderId]);
  if (res.rows.length === 0) return undefined;
  return mapOrder(res.rows[0]);
}

export async function placeOrder(
  pool: Pool,
  orderData: Omit<
    Order,
    | 'orderId'
    | 'status'
    | 'executedQty'
    | 'remainingQty'
    | 'avgFillPrice'
    | 'fee'
    | 'createdAt'
    | 'updatedAt'
    | 'positionEffect'
    | 'rejectionReason'
    | 'settlementCurrency'
    | 'feeCurrency'
    | 'pnlCurrency'
    | 'collateralCurrency'
  > & {
    settlementCurrency?: string;
    feeCurrency?: string;
    pnlCurrency?: string;
    collateralCurrency?: string;
  },
  initialBalanceDeduct?: boolean
): Promise<Order> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const config = getInstrumentConfig(orderData.instrumentKey);
    const settlementCurrency = orderData.settlementCurrency || config.settlementCurrency;
    const feeCurrency = orderData.feeCurrency || config.feeCurrency;
    const pnlCurrency = orderData.pnlCurrency || config.pnlCurrency;
    const collateralCurrency = orderData.collateralCurrency || config.collateralCurrency;
    await lockMarginResources(client, orderData.userId, collateralCurrency);

    if (orderData.qty <= 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      throw new Error(
        `Invalid order quantity: qty must be strictly positive (> 0), received ${orderData.qty}`
      );
    }

    const now = Date.now();
    const order: Order = {
      ...orderData,
      orderId: crypto.randomUUID(),
      status: 'Open',
      executedQty: 0,
      remainingQty: orderData.qty,
      avgFillPrice: 0,
      fee: 0,
      settlementCurrency,
      feeCurrency,
      pnlCurrency,
      collateralCurrency,
      createdAt: now,
      updatedAt: now,
    };

    const posRes = await client.query(
      'SELECT * FROM te_positions WHERE user_id = $1 AND instrument_key = $2 FOR UPDATE',
      [order.userId, order.instrumentKey]
    );
    const position = posRes.rows.length > 0 ? mapPosition(posRes.rows[0]) : null;
    const hasPosition = position && position.status === 'Open';

    if (hasPosition) {
      const isOpposite =
        (position.side === 'Long' && order.side === 'Sell') ||
        (position.side === 'Short' && order.side === 'Buy');
      if (isOpposite) {
        order.positionEffect = 'Close';
        const pendingRes = await client.query(
          `SELECT SUM(remaining_qty) as reserved FROM te_orders WHERE user_id = $1 AND instrument_key = $2 AND side = $3 AND status IN ('Open', 'PartiallyFilled') AND position_effect = 'Close'`,
          [order.userId, order.instrumentKey, order.side]
        );
        const reserved = Number(pendingRes.rows[0].reserved || 0);
        const available = position.qty - reserved;

        if (order.qty > available) {
          order.status = 'Rejected';
          order.rejectionReason = `Order quantity exceeds available position quantity (Position: ${position.qty}, Reserved: ${reserved})`;
        }
      } else {
        order.positionEffect = 'Open';
        if (order.reduceOnly) {
          order.status = 'Rejected';
          order.rejectionReason = 'reduceOnly order cannot increase position';
        }
      }
    } else {
      order.positionEffect = 'Open';
      if (order.reduceOnly) {
        order.status = 'Rejected';
        order.rejectionReason = 'No open position to reduce';
      }
    }

    if (order.status !== 'Rejected') {
      // Check required margin for Open position effect
      if (order.positionEffect === 'Open') {
        const margin = await calculateMargin(client, order.userId, order.collateralCurrency);
        const leverage = 1;
        const requiredMarginDec = new Decimal(order.qty)
          .mul(new Decimal(order.price || 0))
          .div(new Decimal(leverage));
        const requiredMargin = requiredMarginDec.toNumber();

        if (requiredMargin > 0 && margin.availableBalance < requiredMargin) {
          order.status = 'Rejected';
          order.rejectionReason = `Insufficient margin in ${order.collateralCurrency}: required ${requiredMargin}, available ${margin.availableBalance}`;
        }
      }
    }

    await client.query('SAVEPOINT insert_order_sp');
    try {
      await client.query(
        `INSERT INTO te_orders (order_id, user_id, instrument_key, side, order_type, qty, price, reduce_only, position_effect, rejection_reason, status, executed_qty, remaining_qty, avg_fill_price, fee, settlement_currency, fee_currency, pnl_currency, collateral_currency, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          order.orderId,
          order.userId,
          order.instrumentKey,
          order.side,
          order.orderType,
          order.qty,
          order.price,
          order.reduceOnly,
          order.positionEffect,
          order.rejectionReason || null,
          order.status,
          order.executedQty,
          order.remainingQty,
          order.avgFillPrice,
          order.fee,
          order.settlementCurrency,
          order.feeCurrency,
          order.pnlCurrency,
          order.collateralCurrency,
          order.createdAt,
          order.updatedAt,
        ]
      );
    } catch (e: any) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT insert_order_sp');
      } catch (e) {}
      if (e?.message?.includes('does not exist')) {
        await client.query(
          `INSERT INTO te_orders (order_id, user_id, instrument_key, side, order_type, qty, price, reduce_only, position_effect, rejection_reason, status, executed_qty, remaining_qty, avg_fill_price, fee, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            order.orderId,
            order.userId,
            order.instrumentKey,
            order.side,
            order.orderType,
            order.qty,
            order.price,
            order.reduceOnly,
            order.positionEffect,
            order.rejectionReason || null,
            order.status,
            order.executedQty,
            order.remainingQty,
            order.avgFillPrice,
            order.fee,
            order.createdAt,
            order.updatedAt,
          ]
        );
      } else {
        throw e;
      }
    }

    if (order.status !== 'Rejected') {
      const updatedMargin = await calculateMargin(client, order.userId, order.collateralCurrency);
      await client.query(
        `UPDATE te_balances SET locked_balance=$1, updated_at=$2 WHERE user_id=$3 AND currency=$4`,
        [updatedMargin.usedMargin, Date.now(), order.userId, order.collateralCurrency]
      );
    }

    await client.query('COMMIT');
    return order;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelOrder(pool: Pool, orderId: string): Promise<Order | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const initialOrderRes = await client.query(
      'SELECT user_id, instrument_key, collateral_currency FROM te_orders WHERE order_id = $1',
      [orderId]
    );
    if (initialOrderRes.rows.length === 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      return null;
    }
    const initialOrder = initialOrderRes.rows[0];
    const currency =
      initialOrder.collateral_currency ||
      getInstrumentConfig(initialOrder.instrument_key).collateralCurrency;
    await lockMarginResources(client, initialOrder.user_id, currency);
    const orderRes = await client.query('SELECT * FROM te_orders WHERE order_id = $1 FOR UPDATE', [
      orderId,
    ]);
    if (orderRes.rows.length === 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      return null;
    }
    const order = mapOrder(orderRes.rows[0]);
    if (order.status === 'Open' || order.status === 'PartiallyFilled') {
      order.status = 'Cancelled';
      order.updatedAt = Date.now();
      await client.query('UPDATE te_orders SET status = $1, updated_at = $2 WHERE order_id = $3', [
        order.status,
        order.updatedAt,
        order.orderId,
      ]);

      // Update locked_balance after cancellation
      const updatedMargin = await calculateMargin(client, order.userId, order.collateralCurrency);
      await client.query(
        `UPDATE te_balances SET locked_balance=$1, updated_at=$2 WHERE user_id=$3 AND currency=$4`,
        [updatedMargin.usedMargin, order.updatedAt, order.userId, order.collateralCurrency]
      );

      await client.query(
        'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          'orderCancelled',
          order.userId,
          JSON.stringify(order),
          'pending',
          order.settlementCurrency,
          Date.now(),
        ]
      );

      await client.query('COMMIT');
      return order;
    }
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    return null;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    throw e;
  } finally {
    client.release();
  }
}

export async function executeTrade(
  pool: Pool,
  orderId: string,
  fillQty: number,
  fillPrice: number,
  executionId?: string,
  options?: { source?: string; externalExecutionId?: string }
): Promise<Trade | null> {
  const client = await pool.connect();
  const actualExecutionId = executionId || crypto.randomUUID();

  try {
    await client.query('BEGIN');

    const initialOrderRes = await client.query(
      'SELECT user_id, instrument_key, collateral_currency FROM te_orders WHERE order_id = $1',
      [orderId]
    );
    if (initialOrderRes.rows.length === 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      return null;
    }
    const initialOrder = initialOrderRes.rows[0];
    const currency =
      initialOrder.collateral_currency ||
      getInstrumentConfig(initialOrder.instrument_key).collateralCurrency;

    await lockMarginResources(client, initialOrder.user_id, currency);

    const execCheck = await client.query(
      'SELECT * FROM te_executions WHERE execution_id = $1 FOR UPDATE',
      [actualExecutionId]
    );
    if (execCheck.rows.length > 0) {
      const existingExec = execCheck.rows[0];
      if (
        Number(existingExec.fill_qty) === fillQty &&
        Number(existingExec.fill_price) === fillPrice &&
        existingExec.order_id === orderId
      ) {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
        return null; // Already processed
      } else {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
        throw new Error('Conflict: execution_id already exists with different data');
      }
    }

    if (options?.source && options?.externalExecutionId) {
      const extCheck = await client.query(
        'SELECT * FROM te_executions WHERE source = $1 AND external_execution_id = $2 FOR UPDATE',
        [options.source, options.externalExecutionId]
      );
      if (extCheck.rows.length > 0) {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
        return null;
      }
    }

    if (fillQty <= 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      throw new Error(
        `Invalid fill quantity: fillQty must be strictly positive (> 0), received ${fillQty}`
      );
    }
    const orderRes = await client.query('SELECT * FROM te_orders WHERE order_id = $1 FOR UPDATE', [
      orderId,
    ]);
    if (orderRes.rows.length === 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      return null;
    }
    const order = mapOrder(orderRes.rows[0]);

    if (order.status !== 'Open' && order.status !== 'PartiallyFilled') {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      return null;
    }

    const posRes = await client.query(
      'SELECT * FROM te_positions WHERE user_id = $1 AND instrument_key = $2 FOR UPDATE',
      [order.userId, order.instrumentKey]
    );
    let oldPosition = posRes.rows.length > 0 ? mapPosition(posRes.rows[0]) : null;
    const hasPosition =
      oldPosition &&
      (oldPosition.status === 'Open' ||
        oldPosition.status === 'MarginCall' ||
        oldPosition.status === 'OPEN' ||
        oldPosition.status === 'MARGIN_CALL');

    if (order.positionEffect === 'Close') {
      if (!hasPosition) {
        order.status = 'Rejected';
        order.rejectionReason = 'Position closed before execution';
        order.updatedAt = Date.now();
        await client.query(
          `UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4`,
          [order.status, order.rejectionReason, order.updatedAt, order.orderId]
        );
        await client.query(
          'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            'orderUpdated',
            order.userId,
            JSON.stringify(order),
            'pending',
            order.settlementCurrency,
            order.updatedAt,
          ]
        );
        await client.query(
          `INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            actualExecutionId,
            orderId,
            order.userId,
            order.instrumentKey,
            order.side,
            fillQty,
            0,
            0,
            0,
            order.settlementCurrency,
            order.feeCurrency,
            order.pnlCurrency || order.settlementCurrency,
            'REJECTED',
            Date.now(),
            Date.now(),
            options?.source || null,
            options?.externalExecutionId || null,
          ]
        );
        await client.query('COMMIT');
        return null;
      }

      const isOpposite =
        (oldPosition.side === 'Long' && order.side === 'Sell') ||
        (oldPosition.side === 'Short' && order.side === 'Buy');
      if (!isOpposite) {
        order.status = 'Rejected';
        order.rejectionReason = 'Position side changed';
        order.updatedAt = Date.now();
        await client.query(
          `UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4`,
          [order.status, order.rejectionReason, order.updatedAt, order.orderId]
        );
        await client.query(
          `INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            actualExecutionId,
            orderId,
            order.userId,
            order.instrumentKey,
            order.side,
            fillQty,
            0,
            0,
            0,
            order.settlementCurrency,
            order.feeCurrency,
            order.pnlCurrency || order.settlementCurrency,
            'REJECTED',
            Date.now(),
            Date.now(),
            options?.source || null,
            options?.externalExecutionId || null,
          ]
        );
        await client.query('COMMIT');
        return null;
      }

      if (fillQty > oldPosition.qty) {
        fillQty = oldPosition.qty;
      }
    } else if (order.positionEffect === 'Open') {
      if (hasPosition) {
        const isOpposite =
          (oldPosition.side === 'Long' && order.side === 'Sell') ||
          (oldPosition.side === 'Short' && order.side === 'Buy');
        if (isOpposite) {
          order.status = 'Rejected';
          order.rejectionReason = 'Cannot open opposite position while current position exists';
          order.updatedAt = Date.now();
          await client.query(
            `UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4`,
            [order.status, order.rejectionReason, order.updatedAt, order.orderId]
          );
          await client.query(
            `INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              actualExecutionId,
              orderId,
              order.userId,
              order.instrumentKey,
              order.side,
              fillQty,
              0,
              0,
              0,
              order.settlementCurrency,
              order.feeCurrency,
              order.pnlCurrency || order.settlementCurrency,
              'REJECTED',
              Date.now(),
              Date.now(),
              options?.source || null,
              options?.externalExecutionId || null,
            ]
          );
          await client.query('COMMIT');
          return null;
        }
      }
    }

    const requestedQty = fillQty;
    if (fillQty <= 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      throw new Error(
        `Invalid trade execution quantity: fillQty must be strictly positive (> 0), received ${fillQty}`
      );
    }

    if (order.positionEffect === 'Close') {
      if (!oldPosition || oldPosition.status !== 'Open' || oldPosition.qty <= 0) {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
        throw new Error('Cannot close position with zero or negative quantity');
      }
      if (fillQty > oldPosition.qty) {
        fillQty = oldPosition.qty;
      }
    }

    if (fillQty > order.remainingQty) {
      fillQty = order.remainingQty;
    }
    if (fillQty <= 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      throw new Error(
        `Invalid trade execution quantity: fillQty must be strictly positive (> 0), received ${fillQty}`
      );
    }

    const instrumentConfig = getInstrumentConfig(order.instrumentKey);
    const settlementCurrency = order.settlementCurrency || instrumentConfig.settlementCurrency;
    const feeCurrency = order.feeCurrency || instrumentConfig.feeCurrency;
    const pnlCurrency = order.pnlCurrency || instrumentConfig.pnlCurrency;
    const collateralCurrency = order.collateralCurrency || instrumentConfig.collateralCurrency;

    const totalCost = order.avgFillPrice * order.executedQty + fillPrice * fillQty;
    const fee = fillQty * fillPrice * 0.0025;

    order.executedQty += fillQty;
    order.fee += fee;
    order.remainingQty -= fillQty;
    order.avgFillPrice = totalCost / order.executedQty;
    order.updatedAt = Date.now();

    if (order.remainingQty === 0) {
      order.status = 'Filled';
    } else {
      if (order.positionEffect === 'Close' && oldPosition && oldPosition.qty - fillQty <= 0) {
        order.status = 'Rejected';
        order.rejectionReason = 'Position fully closed, cancelling remaining order quantity';
      } else {
        order.status = 'PartiallyFilled';
      }
    }

    const trade: Trade = {
      tradeId: crypto.randomUUID(),
      orderId: order.orderId,
      userId: order.userId,
      instrumentKey: order.instrumentKey,
      side: order.side,
      qty: fillQty,
      price: fillPrice,
      timestamp: Date.now(),
      fee: fee,
      feeCurrency,
      pnlCurrency,
      settlementCurrency,
    };

    let newPosition: Position;
    const isBuy = order.side === 'Buy';

    if (
      !oldPosition ||
      oldPosition.status === 'Closed' ||
      oldPosition.status === 'Liquidated' ||
      oldPosition.status === 'LIQUIDATED' ||
      oldPosition.qty === 0
    ) {
      newPosition = {
        positionId: oldPosition ? oldPosition.positionId : crypto.randomUUID(),
        userId: order.userId,
        instrumentKey: order.instrumentKey,
        side: isBuy ? 'Long' : 'Short',
        qty: fillQty,
        avgEntryPrice: fillPrice,
        markPrice: fillPrice,
        unrealizedPnl: 0,
        realizedPnl: 0,
        status: 'Open',
        settlementCurrency,
        pnlCurrency,
        collateralCurrency,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      newPosition = { ...oldPosition };
      const isIncrease =
        (newPosition.side === 'Long' && isBuy) || (newPosition.side === 'Short' && !isBuy);
      if (isIncrease) {
        const totalValue = newPosition.qty * newPosition.avgEntryPrice + fillQty * fillPrice;
        newPosition.qty += fillQty;
        newPosition.avgEntryPrice = totalValue / newPosition.qty;
        newPosition.updatedAt = Date.now();
      } else {
        const pnlMultiplier = newPosition.side === 'Long' ? 1 : -1;
        const realizedPnl = (fillPrice - newPosition.avgEntryPrice) * fillQty * pnlMultiplier;
        newPosition.realizedPnl += realizedPnl;
        newPosition.qty -= fillQty;
        newPosition.updatedAt = Date.now();
        if (newPosition.qty <= 0) {
          newPosition.qty = 0;
          newPosition.status = 'Closed';
        }
      }
    }

    trade.positionId = newPosition.positionId;

    const oldPnl = oldPosition ? oldPosition.realizedPnl : 0;
    const newPnl = newPosition.realizedPnl;

    const currentTradeRealizedPnl = order.positionEffect === 'Close' ? newPnl - oldPnl : 0;
    trade.realizedPnl = currentTradeRealizedPnl;

    const balRes = await client.query(
      'SELECT available_balance, locked_balance, realized_pnl, total_fees FROM te_balances WHERE user_id = $1 AND currency = $2',
      [order.userId, currency]
    );
    let currentBalance =
      balRes.rows.length > 0
        ? Number(balRes.rows[0].available_balance)
        : currency === 'TON'
          ? 12480.5
          : 0;
    let currentRealizedPnl = balRes.rows.length > 0 ? Number(balRes.rows[0].realized_pnl) : 0;
    let currentTotalFees = balRes.rows.length > 0 ? Number(balRes.rows[0].total_fees) : 0;

    const currentBalanceDecimal = new Decimal(
      balRes.rows.length > 0 ? balRes.rows[0].available_balance : 0
    );
    const usedMarginStr = balRes.rows.length > 0 ? balRes.rows[0].locked_balance : 0;
    const usedMarginDec = new Decimal(usedMarginStr);
    const feeDec = new Decimal(fee);
    const pnlDec = new Decimal(currentTradeRealizedPnl);
    const newBalanceDec = currentBalanceDecimal.minus(feeDec).plus(pnlDec);
    const newBalance = newBalanceDec.toNumber();

    await client.query('SAVEPOINT execute_start_sp');
    await client.query(
      `UPDATE te_orders SET status=$1, executed_qty=$2, remaining_qty=$3, avg_fill_price=$4, fee=$5, updated_at=$6, rejection_reason=$7 WHERE order_id=$8`,
      [
        order.status,
        order.executedQty,
        order.remainingQty,
        order.avgFillPrice,
        order.fee,
        order.updatedAt,
        order.rejectionReason || null,
        order.orderId,
      ]
    );

    await client.query('SAVEPOINT insert_trade_sp');
    try {
      await client.query(
        `INSERT INTO te_trades (trade_id, order_id, user_id, instrument_key, side, qty, price, fee, fee_currency, realized_pnl, pnl_currency, settlement_currency, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          trade.tradeId,
          trade.orderId,
          trade.userId,
          trade.instrumentKey,
          trade.side,
          trade.qty,
          trade.price,
          trade.fee,
          trade.feeCurrency,
          trade.realizedPnl,
          trade.pnlCurrency,
          trade.settlementCurrency,
          trade.timestamp,
        ]
      );
    } catch (e: any) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT insert_trade_sp');
      } catch (e) {}
      await client.query(
        `INSERT INTO te_trades (trade_id, order_id, user_id, instrument_key, side, qty, price, fee, realized_pnl, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          trade.tradeId,
          trade.orderId,
          trade.userId,
          trade.instrumentKey,
          trade.side,
          trade.qty,
          trade.price,
          trade.fee,
          trade.realizedPnl,
          trade.timestamp,
        ]
      );
    }

    if (!oldPosition) {
      await client.query('SAVEPOINT insert_pos_sp');
      try {
        const res = await client.query(
          `INSERT INTO te_positions (position_id, user_id, instrument_key, side, qty, avg_entry_price, mark_price, unrealized_pnl, realized_pnl, status, settlement_currency, pnl_currency, collateral_currency, opened_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (user_id, instrument_key) DO UPDATE SET
             position_id = EXCLUDED.position_id,
             side = EXCLUDED.side,
             qty = EXCLUDED.qty,
             avg_entry_price = EXCLUDED.avg_entry_price,
             mark_price = EXCLUDED.mark_price,
             unrealized_pnl = EXCLUDED.unrealized_pnl,
             realized_pnl = EXCLUDED.realized_pnl,
             status = EXCLUDED.status,
             settlement_currency = EXCLUDED.settlement_currency,
             pnl_currency = EXCLUDED.pnl_currency,
             collateral_currency = EXCLUDED.collateral_currency,
             opened_at = EXCLUDED.opened_at,
             updated_at = EXCLUDED.updated_at`,
          [
            newPosition.positionId,
            newPosition.userId,
            newPosition.instrumentKey,
            newPosition.side,
            newPosition.qty,
            newPosition.avgEntryPrice,
            newPosition.markPrice,
            newPosition.unrealizedPnl,
            newPosition.realizedPnl,
            newPosition.status,
            newPosition.settlementCurrency,
            newPosition.pnlCurrency,
            newPosition.collateralCurrency,
            newPosition.openedAt,
            newPosition.updatedAt,
          ]
        );
        if (res.rowCount === 0) throw new Error('Failed to insert position');
      } catch (e: any) {
        try {
          await client.query('ROLLBACK TO SAVEPOINT insert_pos_sp');
        } catch (e) {}
        const res = await client.query(
          `INSERT INTO te_positions (position_id, user_id, instrument_key, side, qty, avg_entry_price, mark_price, unrealized_pnl, realized_pnl, status, settlement_currency, pnl_currency, collateral_currency, opened_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (user_id, instrument_key) DO UPDATE SET
             position_id = EXCLUDED.position_id,
             side = EXCLUDED.side,
             qty = EXCLUDED.qty,
             avg_entry_price = EXCLUDED.avg_entry_price,
             mark_price = EXCLUDED.mark_price,
             unrealized_pnl = EXCLUDED.unrealized_pnl,
             realized_pnl = EXCLUDED.realized_pnl,
             status = EXCLUDED.status,
             settlement_currency = EXCLUDED.settlement_currency,
             pnl_currency = EXCLUDED.pnl_currency,
             collateral_currency = EXCLUDED.collateral_currency,
             opened_at = EXCLUDED.opened_at,
             updated_at = EXCLUDED.updated_at`,
          [
            newPosition.positionId,
            newPosition.userId,
            newPosition.instrumentKey,
            newPosition.side,
            newPosition.qty,
            newPosition.avgEntryPrice,
            newPosition.markPrice,
            newPosition.unrealizedPnl,
            newPosition.realizedPnl,
            newPosition.status,
            newPosition.settlementCurrency,
            newPosition.pnlCurrency,
            newPosition.collateralCurrency,
            newPosition.openedAt,
            newPosition.updatedAt,
          ]
        );
        if (res.rowCount === 0) throw new Error('Failed to insert position');
      }
    } else {
      await client.query('SAVEPOINT update_pos_sp');
      try {
        const res = await client.query(
          `UPDATE te_positions SET side=$1, qty=$2, avg_entry_price=$3, mark_price=$4, unrealized_pnl=$5, realized_pnl=$6, status=$7, settlement_currency=$8, pnl_currency=$9, collateral_currency=$10, opened_at=$11, updated_at=$12 WHERE position_id=$13`,
          [
            newPosition.side,
            newPosition.qty,
            newPosition.avgEntryPrice,
            newPosition.markPrice,
            newPosition.unrealizedPnl,
            newPosition.realizedPnl,
            newPosition.status,
            newPosition.settlementCurrency,
            newPosition.pnlCurrency,
            newPosition.collateralCurrency,
            newPosition.openedAt,
            newPosition.updatedAt,
            newPosition.positionId,
          ]
        );
        if (res.rowCount === 0) throw new Error('Failed to update position');
      } catch (e: any) {
        try {
          await client.query('ROLLBACK TO SAVEPOINT update_pos_sp');
        } catch (e) {}
        const res = await client.query(
          `UPDATE te_positions SET side=$1, qty=$2, avg_entry_price=$3, mark_price=$4, unrealized_pnl=$5, realized_pnl=$6, status=$7, opened_at=$8, updated_at=$9 WHERE position_id=$10`,
          [
            newPosition.side,
            newPosition.qty,
            newPosition.avgEntryPrice,
            newPosition.markPrice,
            newPosition.unrealizedPnl,
            newPosition.realizedPnl,
            newPosition.status,
            newPosition.openedAt,
            newPosition.updatedAt,
            newPosition.positionId,
          ]
        );
        if (res.rowCount === 0) throw new Error('Failed to update position');
      }
    }

    await recordPositionSnapshot(
      {
        positionId: newPosition.positionId,
        userId: newPosition.userId,
        instrumentKey: newPosition.instrumentKey,
        side: newPosition.side,
        qty: newPosition.qty,
        avgEntryPrice: newPosition.avgEntryPrice,
        status: newPosition.status,
        settlementCurrency: newPosition.settlementCurrency,
        collateralCurrency: newPosition.collateralCurrency,
      },
      newPosition.updatedAt || newPosition.openedAt || Date.now(),
      newPosition.status === 'Closed' ? newPosition.updatedAt || Date.now() : null,
      client
    );

    const updatedMargin = await calculateMargin(client, order.userId, currency);
    const newEquity = newBalance + updatedMargin.totalUnrealizedPnl;
    const newAvailableBalance = newEquity - updatedMargin.usedMargin;

    if (newAvailableBalance < 0 && order.positionEffect === 'Open') {
      try {
        await client.query('ROLLBACK TO SAVEPOINT execute_start_sp');
      } catch (e) {}

      order.status = 'Rejected';
      order.rejectionReason = `Insufficient margin: required ${updatedMargin.usedMargin.toFixed(2)}, available ${newEquity.toFixed(2)}`;
      order.updatedAt = Date.now();

      await client.query(
        `UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4`,
        [order.status, order.rejectionReason, order.updatedAt, order.orderId]
      );

      await client.query(
        `INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          actualExecutionId,
          orderId,
          order.userId,
          order.instrumentKey,
          order.side,
          fillQty,
          0,
          0,
          0,
          settlementCurrency,
          feeCurrency,
          pnlCurrency,
          'REJECTED',
          Date.now(),
          Date.now(),
          options?.source || null,
          options?.externalExecutionId || null,
        ]
      );
      await client.query('COMMIT');
      return null;
    }

    const newLockedBalance = updatedMargin.usedMargin;

    const nowMs = Date.now();
    if (balRes.rows.length === 0) {
      await client.query(
        `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.userId,
          currency,
          newBalance,
          newLockedBalance,
          currentTradeRealizedPnl,
          fee,
          nowMs,
          nowMs,
        ]
      );
    } else {
      await client.query(
        `UPDATE te_balances SET available_balance=$1, locked_balance=$2, realized_pnl=$3, total_fees=$4, updated_at=$5 WHERE user_id=$6 AND currency=$7`,
        [
          newBalance,
          newLockedBalance,
          currentRealizedPnl + currentTradeRealizedPnl,
          currentTotalFees + fee,
          nowMs,
          order.userId,
          currency,
        ]
      );
    }

    const now = Date.now();
    await client.query('SAVEPOINT insert_exec_sp');
    try {
      await client.query(
        `INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          actualExecutionId,
          orderId,
          order.userId,
          order.instrumentKey,
          order.side,
          requestedQty,
          fillQty,
          fillPrice,
          fee,
          settlementCurrency,
          feeCurrency,
          pnlCurrency,
          'COMPLETED',
          now,
          now,
          options?.source || null,
          options?.externalExecutionId || null,
        ]
      );
    } catch (e: any) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT insert_exec_sp');
      } catch (e) {}
      await client.query(
        `INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          actualExecutionId,
          orderId,
          order.userId,
          order.instrumentKey,
          order.side,
          requestedQty,
          fillQty,
          fillPrice,
          fee,
          'COMPLETED',
          now,
          now,
          options?.source || null,
          options?.externalExecutionId || null,
        ]
      );
    }

    const events = [
      { type: 'tradeExecuted', payload: trade },
      { type: 'orderUpdated', payload: order },
      { type: 'positionUpdated', payload: newPosition },
      {
        type: 'balanceUpdated',
        payload: {
          userId: order.userId,
          balance: newBalance,
          availableBalance: newBalance,
          lockedBalance: 0,
          currency: currency,
        },
      },
      { type: 'historyUpdated', payload: { userId: order.userId, trade } },
    ];

    for (const ev of events) {
      await client.query('SAVEPOINT insert_outbox_sp');
      try {
        await client.query(
          'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [ev.type, order.userId, JSON.stringify(ev.payload), 'pending', currency, now]
        );
      } catch (e: any) {
        try {
          await client.query('ROLLBACK TO SAVEPOINT insert_outbox_sp');
        } catch (e) {}
        await client.query(
          'INSERT INTO te_outbox_events (event_type, user_id, payload, status, created_at) VALUES ($1, $2, $3, $4, $5)',
          [ev.type, order.userId, JSON.stringify(ev.payload), 'pending', now]
        );
      }
    }

    await client.query('COMMIT');
    return trade;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    throw e;
  } finally {
    client.release();
  }
}
