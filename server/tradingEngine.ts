import { SchedulerLease } from './schedulerLease';
import { parseInstrumentKey } from '../src/types/market';
import { MOCK_GIFTS_FIXTURE } from './mocks/giftsFixture';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { Pool } from 'pg';

export interface Order {
  orderId: string;
  userId: string;
  instrumentKey: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  qty: number;
  price: number;
  reduceOnly: boolean;
  positionEffect?: 'Open' | 'Close' | 'LIQUIDATE';
  rejectionReason?: string;
  status: 'Open' | 'PartiallyFilled' | 'Filled' | 'Cancelled' | 'Rejected';
  executedQty: number;
  remainingQty: number;
  avgFillPrice: number;
  fee: number;
  settlementCurrency: string;
  feeCurrency: string;
  pnlCurrency: string;
  collateralCurrency: string;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  positionId: string;
  userId: string;
  instrumentKey: string;
  side: 'Long' | 'Short';
  qty: number;
  avgEntryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status:
    | 'Open'
    | 'Closed'
    | 'Liquidated'
    | 'MarginCall'
    | 'PendingLiquidation'
    | 'LiquidationFailed'
    | 'OPEN'
    | 'MARGIN_CALL'
    | 'PENDING_LIQUIDATION'
    | 'LIQUIDATED'
    | 'CLOSED'
    | 'LIQUIDATION_FAILED';
  settlementCurrency: string;
  pnlCurrency: string;
  collateralCurrency: string;
  openedAt: number;
  updatedAt: number;
  liquidationReason?: string;
  liquidationTimestamp?: number;
}

export interface Trade {
  tradeId: string;
  orderId: string;
  userId: string;
  instrumentKey: string;
  side: 'Buy' | 'Sell';
  qty: number;
  price: number;
  fee: number;
  feeCurrency: string;
  realizedPnl?: number;
  positionId?: string;
  pnlCurrency: string;
  settlementCurrency: string;
  timestamp: number;
}

export interface FundingPayment {
  fundingId: string;
  positionId: string;
  userId: string;
  instrumentKey: string;
  currency: string;
  side: 'Long' | 'Short';
  fundingRate: number;
  fundingInterval: string;
  fundingTimestamp: number;
  markPrice: number;
  qty: number;
  notional: number;
  fundingAmount: number;
  status: 'PROCESSED' | 'SKIPPED' | 'FAILED';
  createdAt: number;
  processedAt: number;
  errorReason?: string;
}

export interface FundingPeriodSnapshot {
  instrumentKey: string;
  currency: string;
  fundingInterval: string;
  fundingTimestamp: number;
  fundingRate: number;
  markPrice: number;
  createdAt: number;
}

export interface PositionSnapshot {
  snapshotId: string;
  positionId: string;
  userId: string;
  instrumentKey: string;
  side: 'Long' | 'Short';
  qty: number;
  avgEntryPrice: number;
  status: string;
  settlementCurrency?: string;
  collateralCurrency?: string;
  validFrom: number;
  validTo?: number | null;
  createdAt: number;
}

export interface ProcessFundingOptions {
  instrumentKey?: string;
  currency?: string;
  positionId?: string;
  userId?: string;
  fundingRate?: number;
  overrideMarkPrice?: number;
  fundingInterval?: string;
  fundingTimestamp?: number;
  isCatchUp?: boolean;
}

export interface InstrumentCurrencyConfig {
  settlementCurrency: string;
  collateralCurrency: string;
  feeCurrency: string;
  pnlCurrency: string;
  maintenanceMarginRate: number;
  liquidationFeeRate: number;
  liquidationBuffer?: number;
  markPriceSource: string;
  maxLiquidationRetries: number;
}

const INSTRUMENT_CURRENCY_MAP: Record<string, InstrumentCurrencyConfig> = {};

function validateRates(config: InstrumentCurrencyConfig) {
  if (
    typeof config.maintenanceMarginRate !== 'number' ||
    isNaN(config.maintenanceMarginRate) ||
    !isFinite(config.maintenanceMarginRate) ||
    config.maintenanceMarginRate < 0 ||
    config.maintenanceMarginRate > 1
  ) {
    throw new Error('Invalid maintenanceMarginRate');
  }
  if (
    typeof config.liquidationFeeRate !== 'number' ||
    isNaN(config.liquidationFeeRate) ||
    !isFinite(config.liquidationFeeRate) ||
    config.liquidationFeeRate < 0 ||
    config.liquidationFeeRate > 1
  ) {
    throw new Error('Invalid liquidationFeeRate');
  }
  if (config.liquidationBuffer !== undefined) {
    if (
      typeof config.liquidationBuffer !== 'number' ||
      isNaN(config.liquidationBuffer) ||
      !isFinite(config.liquidationBuffer) ||
      config.liquidationBuffer < 0 ||
      config.liquidationBuffer > 1
    ) {
      throw new Error('Invalid liquidationBuffer');
    }
  }
  if (
    typeof config.maxLiquidationRetries !== 'number' ||
    isNaN(config.maxLiquidationRetries) ||
    !isFinite(config.maxLiquidationRetries) ||
    config.maxLiquidationRetries < 0
  ) {
    throw new Error('Invalid maxLiquidationRetries');
  }
}

function defineInstrument(key: string, currency: string, opts?: Partial<InstrumentCurrencyConfig>) {
  const config: InstrumentCurrencyConfig = {
    settlementCurrency: currency,
    collateralCurrency: currency,
    feeCurrency: currency,
    pnlCurrency: currency,
    maintenanceMarginRate: opts?.maintenanceMarginRate ?? 0.05,
    liquidationFeeRate: opts?.liquidationFeeRate ?? 0.01,
    liquidationBuffer: opts?.liquidationBuffer ?? 0.005,
    markPriceSource: opts?.markPriceSource ?? 'internal_orderbook',
    maxLiquidationRetries: opts?.maxLiquidationRetries ?? 3,
    ...opts,
  };
  validateRates(config);
  INSTRUMENT_CURRENCY_MAP[key] = config;
}

defineInstrument('TON', 'TON');
defineInstrument('TON-USDT', 'TON');
defineInstrument('STARS', 'STARS');
defineInstrument('STARS-USDT', 'STARS');

for (const gift of MOCK_GIFTS_FIXTURE) {
  defineInstrument(gift.id, 'TON');
  defineInstrument(`${gift.id}:all:all:TON`, 'TON');
}
defineInstrument('star', 'STARS');
defineInstrument('star:all:all:STARS', 'STARS');

export function getInstrumentConfig(instrumentKey: string): InstrumentCurrencyConfig {
  const config = INSTRUMENT_CURRENCY_MAP[instrumentKey];
  if (config) return config;

  let curr: 'TON' | 'STARS' | undefined = undefined;
  if (instrumentKey) {
    if (
      instrumentKey.endsWith(':STARS') ||
      instrumentKey.includes('STARS') ||
      instrumentKey === 'star'
    ) {
      curr = 'STARS';
    } else if (
      instrumentKey.endsWith(':TON') ||
      instrumentKey.includes('TON') ||
      instrumentKey === 'TON' ||
      instrumentKey === 'TON-USDT'
    ) {
      curr = 'TON';
    } else if (instrumentKey.includes(':')) {
      try {
        const parsed = parseInstrumentKey(instrumentKey);
        if (parsed.currency === 'TON' || parsed.currency === 'STARS') {
          curr = parsed.currency;
        }
      } catch (e) {}
    }
  }

  const defaultConfig: InstrumentCurrencyConfig = {
    settlementCurrency: curr as any,
    collateralCurrency: curr as any,
    feeCurrency: curr as any,
    pnlCurrency: curr as any,
    maintenanceMarginRate: 0.05,
    liquidationFeeRate: 0.01,
    liquidationBuffer: 0.005,
    markPriceSource: 'internal_orderbook',
    maxLiquidationRetries: 3,
  };
  return defaultConfig;
}

export class PostgresTradingEngine extends EventEmitter {
  private async lockMarginResources(client: any, userId: string, currency: string) {
    // 1. заблокировать валютный Balance через FOR UPDATE;
    await client.query(
      'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
      [userId, currency]
    );
    // 2. заблокировать Position через FOR UPDATE;
    await client.query(
      'SELECT position_id FROM te_positions WHERE user_id = $1 AND collateral_currency = $2 FOR UPDATE',
      [userId, currency]
    );
    // 3. заблокировать Order через FOR UPDATE;
    await client.query(
      'SELECT order_id FROM te_orders WHERE user_id = $1 AND collateral_currency = $2 FOR UPDATE',
      [userId, currency]
    );
  }
  private pool: Pool;

  constructor(pool: Pool) {
    super();
    this.pool = pool;
  }

  public async calculateMargin(client: any, userId: string, currency: string) {
    const balRes = await client.query(
      'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2',
      [userId, currency]
    );
    const walletBalance = balRes.rows.length > 0 ? Number(balRes.rows[0].available_balance) : 0;

    const posRes = await client.query(
      "SELECT qty, avg_entry_price, side, mark_price, instrument_key FROM te_positions WHERE user_id = $1 AND (collateral_currency = $2 OR collateral_currency IS NULL) AND status IN ('Open', 'MarginCall')",
      [userId, currency]
    );
    let totalUnrealizedPnl = 0;
    let totalUsedMargin = 0;
    let totalPositionNotional = 0;
    let maintenanceMargin = 0;
    const leverage = 1;

    for (const pos of posRes.rows) {
      const qty = Number(pos.qty);
      const entryPrice = Number(pos.avg_entry_price);
      const markPrice = pos.mark_price != null ? Number(pos.mark_price) : entryPrice;
      const side = pos.side;

      const config = getInstrumentConfig(pos.instrument_key);
      const maintenanceMarginRate = config.maintenanceMarginRate;

      const initialMargin = (qty * entryPrice) / leverage;
      totalUsedMargin += initialMargin;

      const notional = qty * markPrice;
      totalPositionNotional += notional;
      maintenanceMargin += notional * maintenanceMarginRate;

      const pnlMultiplier = side === 'Long' ? 1 : -1;
      totalUnrealizedPnl += (markPrice - entryPrice) * qty * pnlMultiplier;
    }

    const ordRes = await client.query(
      `SELECT remaining_qty, price FROM te_orders WHERE user_id = $1 AND collateral_currency = $2 AND status IN ('Open', 'PartiallyFilled') AND position_effect = 'Open'`,
      [userId, currency]
    );
    let totalOrderMargin = 0;
    for (const ord of ordRes.rows) {
      const rQty = Number(ord.remaining_qty);
      const price = Number(ord.price);
      totalOrderMargin += (rQty * price) / leverage;
    }

    const usedMargin = totalUsedMargin + totalOrderMargin;
    const equity = walletBalance + totalUnrealizedPnl;
    const availableBalance = equity - usedMargin;
    const marginRatio = totalPositionNotional > 0 ? equity / totalPositionNotional : 0;

    return {
      walletBalance,
      equity,
      usedMargin,
      availableBalance,
      totalUnrealizedPnl,
      totalUsedMargin,
      totalOrderMargin,
      maintenanceMargin,
      marginRatio,
    };
  }

  public async getMarginInfo(userId: string, currency: string) {
    const client = await this.pool.connect();
    try {
      return await this.calculateMargin(client, userId, currency);
    } finally {
      client.release();
    }
  }

  public async getBalance(userId: string, currency: string = 'TON'): Promise<number> {
    const res = await this.pool.query(
      'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2',
      [userId, currency]
    );
    if (res.rows.length === 0) return 0;
    return Number(res.rows[0].available_balance);
  }

  public async getAllPositions(userId: string): Promise<Position[]> {
    const res = await this.pool.query('SELECT * FROM te_positions WHERE user_id = $1', [userId]);
    return res.rows.map((r) => this.mapPosition(r));
  }

  public async getUserOrders(userId: string): Promise<Order[]> {
    const res = await this.pool.query(
      'SELECT * FROM te_orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return res.rows.map((r) => this.mapOrder(r));
  }

  public async getActiveOrders(instrumentKey: string): Promise<Order[]> {
    const res = await this.pool.query(
      "SELECT * FROM te_orders WHERE instrument_key = $1 AND status IN ('Open', 'PartiallyFilled') ORDER BY created_at ASC",
      [instrumentKey]
    );
    return res.rows.map((r) => this.mapOrder(r));
  }

  public async getUserTrades(userId: string): Promise<Trade[]> {
    const res = await this.pool.query(
      'SELECT * FROM te_trades WHERE user_id = $1 ORDER BY timestamp DESC',
      [userId]
    );
    return res.rows.map((r) => this.mapTrade(r));
  }

  public async getOrder(orderId: string): Promise<Order | undefined> {
    const res = await this.pool.query('SELECT * FROM te_orders WHERE order_id = $1', [orderId]);
    if (res.rows.length === 0) return undefined;
    return this.mapOrder(res.rows[0]);
  }

  private mapOrder(r: any): Order {
    const config = getInstrumentConfig(r.instrument_key);
    return {
      orderId: r.order_id,
      userId: r.user_id,
      instrumentKey: r.instrument_key,
      side: r.side,
      orderType: r.order_type,
      qty: Number(r.qty),
      price: Number(r.price),
      reduceOnly: r.reduce_only,
      positionEffect: r.position_effect,
      rejectionReason: r.rejection_reason,
      status: r.status,
      executedQty: Number(r.executed_qty),
      remainingQty: Number(r.remaining_qty),
      avgFillPrice: Number(r.avg_fill_price),
      fee: Number(r.fee),
      settlementCurrency: r.settlement_currency || config.settlementCurrency,
      feeCurrency: r.fee_currency || config.feeCurrency,
      pnlCurrency: r.pnl_currency || config.pnlCurrency,
      collateralCurrency: r.collateral_currency || config.collateralCurrency,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  private mapPosition(r: any): Position {
    const config = getInstrumentConfig(r.instrument_key);
    return {
      positionId: r.position_id || 'pos_' + r.user_id + '_' + r.instrument_key,
      userId: r.user_id,
      instrumentKey: r.instrument_key,
      side: r.side,
      qty: Number(r.qty),
      avgEntryPrice: Number(r.avg_entry_price),
      markPrice: Number(r.mark_price),
      unrealizedPnl: Number(r.unrealized_pnl),
      realizedPnl: Number(r.realized_pnl),
      status: r.status,
      settlementCurrency: r.settlement_currency || config.settlementCurrency,
      pnlCurrency: r.pnl_currency || config.pnlCurrency,
      collateralCurrency: r.collateral_currency || config.collateralCurrency,
      openedAt: Number(r.opened_at || r.created_at),
      updatedAt: Number(r.updated_at),
      liquidationTimestamp: r.liquidation_timestamp ? Number(r.liquidation_timestamp) : undefined,
      liquidationReason: r.liquidation_reason || undefined,
    };
  }

  private mapTrade(r: any): Trade {
    const config = getInstrumentConfig(r.instrument_key);
    return {
      tradeId: r.trade_id,
      orderId: r.order_id,
      userId: r.user_id,
      instrumentKey: r.instrument_key,
      side: r.side,
      qty: Number(r.qty),
      price: Number(r.price),
      fee: Number(r.fee),
      feeCurrency: r.fee_currency || config.feeCurrency,
      realizedPnl: Number(r.realized_pnl),
      pnlCurrency: r.pnl_currency || config.pnlCurrency,
      settlementCurrency: r.settlement_currency || config.settlementCurrency,
      timestamp: Number(r.timestamp),
    };
  }

  public async placeOrder(
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const config = getInstrumentConfig(orderData.instrumentKey);
      const settlementCurrency = orderData.settlementCurrency || config.settlementCurrency;
      const feeCurrency = orderData.feeCurrency || config.feeCurrency;
      const pnlCurrency = orderData.pnlCurrency || config.pnlCurrency;
      const collateralCurrency = orderData.collateralCurrency || config.collateralCurrency;
      await this.lockMarginResources(client, orderData.userId, collateralCurrency);

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
      const position = posRes.rows.length > 0 ? this.mapPosition(posRes.rows[0]) : null;
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
        // Заблокировать соответствующий валютный Balance

        if (order.positionEffect === 'Open') {
          const margin = await this.calculateMargin(client, order.userId, order.collateralCurrency);
          const leverage = 1;
          const requiredMargin = (order.qty * (order.price || 0)) / leverage;

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
        const updatedMargin = await this.calculateMargin(
          client,
          order.userId,
          order.collateralCurrency
        );
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

  public async cancelOrder(orderId: string): Promise<Order | null> {
    const client = await this.pool.connect();
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
      await this.lockMarginResources(client, initialOrder.user_id, currency);
      const orderRes = await client.query(
        'SELECT * FROM te_orders WHERE order_id = $1 FOR UPDATE',
        [orderId]
      );
      if (orderRes.rows.length === 0) {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
        return null;
      }
      const order = this.mapOrder(orderRes.rows[0]);
      if (order.status === 'Open' || order.status === 'PartiallyFilled') {
        order.status = 'Cancelled';
        order.updatedAt = Date.now();
        await client.query(
          'UPDATE te_orders SET status = $1, updated_at = $2 WHERE order_id = $3',
          [order.status, order.updatedAt, order.orderId]
        );

        // Update locked_balance after cancellation
        const updatedMargin = await this.calculateMargin(
          client,
          order.userId,
          order.collateralCurrency
        );
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

  public async executeTrade(
    orderId: string,
    fillQty: number,
    fillPrice: number,
    executionId?: string,
    options?: { source?: string; externalExecutionId?: string }
  ): Promise<Trade | null> {
    const client = await this.pool.connect();
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

      await this.lockMarginResources(client, initialOrder.user_id, currency);

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
      const orderRes = await client.query(
        'SELECT * FROM te_orders WHERE order_id = $1 FOR UPDATE',
        [orderId]
      );
      if (orderRes.rows.length === 0) {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
        return null;
      }
      const order = this.mapOrder(orderRes.rows[0]);

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
      let oldPosition = posRes.rows.length > 0 ? this.mapPosition(posRes.rows[0]) : null;
      const hasPosition =
        oldPosition &&
        (oldPosition.status === 'Open' ||
          oldPosition.status === 'MarginCall' ||
          oldPosition.status === 'OPEN' ||
          oldPosition.status === 'MARGIN_CALL');

      let executionStatus = 'PROCESSING';
      let rejectedReason = '';

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

      if (!oldPosition || oldPosition.status === 'Closed') {
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
          // Формула усреднения позиции:
          // Новая маржа = ((Старый Qty * Старая Цена) + (Добавленный Qty * Цена Исполнения)) / Leverage
          // (Реализуется автоматически через пересчет avgEntryPrice и qty, и последующий вызов calculateMargin)
          const totalValue = newPosition.qty * newPosition.avgEntryPrice + fillQty * fillPrice;
          newPosition.qty += fillQty;
          newPosition.avgEntryPrice = totalValue / newPosition.qty;
          newPosition.updatedAt = Date.now();
        } else {
          // Формула частичного / полного закрытия позиции:
          // Освобождаемая маржа = (Закрываемый Qty * Старая Цена) / Leverage
          // При частичном закрытии (qty > 0) освобождается пропорциональная часть.
          // При полном закрытии (qty = 0) освобождается вся маржа.
          // (Реализуется за счет уменьшения qty в newPosition, и вызова calculateMargin)
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

      const newBalance = currentBalance - fee + currentTradeRealizedPnl;

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

      await this.recordPositionSnapshot(
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

      const updatedMargin = await this.calculateMargin(client, order.userId, currency);
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

  public async updateMarkPrice(instrumentKey: string, markPrice: number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const posRes = await client.query(
        "SELECT * FROM te_positions WHERE instrument_key = $1 AND status IN ('Open', 'MarginCall') FOR UPDATE",
        [instrumentKey]
      );

      const liquidatedUsers = new Set<string>();

      for (const row of posRes.rows) {
        const position = this.mapPosition(row);

        if (liquidatedUsers.has(position.userId)) continue;

        // 2. Обновить markPrice.
        position.markPrice = markPrice;

        // 3. Пересчитать unrealizedPnl.
        const pnlMultiplier = position.side === 'Long' ? 1 : -1;
        position.unrealizedPnl =
          (markPrice - position.avgEntryPrice) * position.qty * pnlMultiplier;

        // 4. Записать изменения в PostgreSQL BEFORE calculateMargin so it uses updated values
        await client.query(
          'UPDATE te_positions SET mark_price = $1, unrealized_pnl = $2 WHERE position_id = $3',
          [position.markPrice, position.unrealizedPnl, position.positionId]
        );

        // Пересчитать equity и margin state.
        const marginInfo = await this.calculateMargin(
          client,
          position.userId,
          position.collateralCurrency
        );

        // 5. Определить:
        // достаточно ли маржи;
        // нужен ли MARGIN_CALL;
        // нужна ли liquidation.
        let newStatus = position.status;
        let isLiquidationNeeded = false;

        if (marginInfo.equity <= marginInfo.maintenanceMargin && marginInfo.maintenanceMargin > 0) {
          isLiquidationNeeded = true;
        } else if (marginInfo.equity < marginInfo.usedMargin) {
          newStatus = 'MarginCall';
        } else {
          newStatus = 'Open';
        }

        if (isLiquidationNeeded) {
          // We do liquidation
          await this.liquidateUser(client, position.userId, position.collateralCurrency);
          liquidatedUsers.add(position.userId);
          continue;
        }

        if (newStatus !== position.status) {
          position.status = newStatus as any;
          await client.query('UPDATE te_positions SET status = $1 WHERE position_id = $2', [
            newStatus,
            position.positionId,
          ]);
          if (newStatus === 'MarginCall') {
            await client.query(
              'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
              [
                'marginCall',
                position.userId,
                JSON.stringify({
                  userId: position.userId,
                  instrumentKey: position.instrumentKey,
                  status: 'MarginCall',
                }),
                'pending',
                position.settlementCurrency,
                Date.now(),
              ]
            );
          }
        }

        // 7. Создать outbox event в той же транзакции.
        await client.query('SAVEPOINT insert_outbox_mark_sp');
        try {
          await client.query(
            'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [
              'positionUpdated',
              position.userId,
              JSON.stringify(position),
              'pending',
              position.settlementCurrency,
              Date.now(),
            ]
          );
        } catch (e: any) {
          try {
            await client.query('ROLLBACK TO SAVEPOINT insert_outbox_mark_sp');
          } catch (e) {}
          await client.query(
            'INSERT INTO te_outbox_events (event_type, user_id, payload, status, created_at) VALUES ($1, $2, $3, $4, $5)',
            ['positionUpdated', position.userId, JSON.stringify(position), 'pending', Date.now()]
          );
        }
      }

      // 8. Выполнить commit.
      await client.query('COMMIT');
    } catch (e) {
      console.error('Error in updateMarkPrice', e);
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
    } finally {
      client.release();
    }
  }

  public async liquidateUser(
    clientArg: any,
    userId: string,
    currency: string,
    executionIdOrOptions?: string | { executionId?: string; tradeId?: string },
    tradeIdParam?: string
  ): Promise<any> {
    let client = clientArg;
    let ownClient = false;
    if (!client) {
      client = await this.pool.connect();
      ownClient = true;
    }

    let passedExecutionId: string | undefined;
    let passedTradeId: string | undefined;

    if (typeof executionIdOrOptions === 'string') {
      passedExecutionId = executionIdOrOptions;
      passedTradeId = tradeIdParam;
    } else if (executionIdOrOptions && typeof executionIdOrOptions === 'object') {
      passedExecutionId = executionIdOrOptions.executionId;
      passedTradeId = executionIdOrOptions.tradeId;
    }

    try {
      if (ownClient) {
        await client.query('BEGIN');
      }

      const nowMs = Date.now();

      // Check for duplicate execution or trade if identifier was provided
      if (passedExecutionId) {
        const execCheck = await client.query(
          'SELECT * FROM te_executions WHERE execution_id = $1 FOR UPDATE',
          [passedExecutionId]
        );
        if (execCheck.rows.length > 0) {
          const existingExec = execCheck.rows[0];
          const tradeRes = await client.query(
            'SELECT * FROM te_trades WHERE order_id = $1 OR trade_id = $2',
            [existingExec.order_id, passedTradeId || '']
          );
          if (ownClient) await client.query('COMMIT');
          if (tradeRes.rows.length > 0) {
            return this.mapTrade(tradeRes.rows[0]);
          }
          return {
            tradeId: existingExec.execution_id,
            orderId: existingExec.order_id,
            userId: existingExec.user_id,
            instrumentKey: existingExec.instrument_key,
            side: existingExec.side,
            qty: Number(existingExec.fill_qty),
            price: Number(existingExec.fill_price),
            fee: Number(existingExec.fee),
            feeCurrency: existingExec.fee_currency,
            realizedPnl: 0,
            pnlCurrency: existingExec.pnl_currency,
            settlementCurrency: existingExec.settlement_currency,
            timestamp: Number(existingExec.processed_at || existingExec.created_at),
          };
        }
      }

      if (passedTradeId) {
        const tradeCheck = await client.query(
          'SELECT * FROM te_trades WHERE trade_id = $1 FOR UPDATE',
          [passedTradeId]
        );
        if (tradeCheck.rows.length > 0) {
          if (ownClient) await client.query('COMMIT');
          return this.mapTrade(tradeCheck.rows[0]);
        }
      }

      // 1. Проверить позицию. Заблокировать Position через FOR UPDATE.
      const posRes = await client.query(
        `SELECT * FROM te_positions WHERE user_id = $1 AND (collateral_currency = $2 OR collateral_currency IS NULL) AND status IN ('Open', 'MarginCall') FOR UPDATE`,
        [userId, currency]
      );

      if (posRes.rows.length === 0) {
        if (passedExecutionId) {
          const execCheck = await client.query(
            'SELECT * FROM te_executions WHERE execution_id = $1',
            [passedExecutionId]
          );
          if (execCheck.rows.length > 0) {
            const tradeRes = await client.query('SELECT * FROM te_trades WHERE order_id = $1', [
              execCheck.rows[0].order_id,
            ]);
            if (ownClient) await client.query('COMMIT');
            if (tradeRes.rows.length > 0) return this.mapTrade(tradeRes.rows[0]);
            return execCheck.rows[0];
          }
        }
        if (passedTradeId) {
          const tradeCheck = await client.query('SELECT * FROM te_trades WHERE trade_id = $1', [
            passedTradeId,
          ]);
          if (tradeCheck.rows.length > 0) {
            if (ownClient) await client.query('COMMIT');
            return this.mapTrade(tradeCheck.rows[0]);
          }
        }
        if (ownClient) await client.query('COMMIT');
        return null; // Если позиция уже закрыта или ликвидирована, не выполнять liquidation повторно.
      }

      // 2. Заблокировать соответствующий валютный Balance через FOR UPDATE.
      const balRes = await client.query(
        `SELECT * FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
        [userId, currency]
      );

      // Cancel all open orders for this currency (frees up margin)
      const ordRes = await client.query(
        `SELECT * FROM te_orders WHERE user_id = $1 AND (collateral_currency = $2 OR collateral_currency IS NULL) AND status IN ('Open', 'PartiallyFilled') FOR UPDATE`,
        [userId, currency]
      );
      for (const row of ordRes.rows) {
        const order = this.mapOrder(row);
        order.status = 'Cancelled';
        order.updatedAt = nowMs;
        await client.query(
          `UPDATE te_orders SET status = 'Cancelled', updated_at = $1 WHERE order_id = $2`,
          [nowMs, order.orderId]
        );
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          ['orderCancelled', userId, JSON.stringify(order), 'pending', currency, nowMs]
        );
      }

      // 3 & 4. Повторно прочитать актуальный markPrice. Повторно проверить liquidation condition внутри транзакции.
      const marginInfo = await this.calculateMargin(client, userId, currency);

      // 5. Если условие liquidation больше не выполняется, отменить liquidation без изменения баланса.
      if (marginInfo.equity > marginInfo.maintenanceMargin) {
        if (ownClient) await client.query('COMMIT');
        return null;
      }

      let totalRealizedLoss = 0;
      let totalLiquidationFee = 0;
      let remainingEquity = marginInfo.equity;
      let lastTradeResult: any = null;

      for (let i = 0; i < posRes.rows.length; i++) {
        const row = posRes.rows[i];
        const pos = this.mapPosition(row);

        const config = getInstrumentConfig(pos.instrumentKey);

        // 6. Рассчитать финальный PnL по стороне позиции.
        const pnlMultiplier = pos.side === 'Long' ? 1 : -1;
        const unrealizedPnl = (pos.markPrice - pos.avgEntryPrice) * pos.qty * pnlMultiplier;
        const loss = unrealizedPnl;
        totalRealizedLoss += loss;

        // 7. Рассчитать liquidation fee.
        const notional = pos.qty * pos.markPrice;
        const idealFee = notional * config.liquidationFeeRate;

        let actualFee = 0;
        let reasonNote = 'Margin call';
        if (remainingEquity > 0) {
          actualFee = Math.min(idealFee, remainingEquity);
          remainingEquity -= actualFee;
          if (actualFee < idealFee) {
            reasonNote = 'Margin call (fee capped at remaining equity)';
          }
        } else {
          reasonNote = 'Margin call (zero fee due to negative equity)';
        }

        const liquidationFee = actualFee;
        totalLiquidationFee += liquidationFee;

        // 8 & 9. Закрыть позицию с qty=0. Установить status=LIQUIDATED.
        const closedQty = pos.qty;
        if (closedQty <= 0) {
          throw new Error(
            `Cannot liquidate position with zero or negative quantity: pos.qty = ${closedQty}`
          );
        }
        pos.status = 'Liquidated';
        pos.qty = 0;
        pos.realizedPnl += loss;
        pos.unrealizedPnl = 0;
        pos.liquidationTimestamp = nowMs;
        pos.liquidationReason = reasonNote;

        await client.query(
          `UPDATE te_positions SET status = 'Liquidated', qty = 0, realized_pnl = realized_pnl + $1, unrealized_pnl = 0, updated_at = $2, liquidation_timestamp = $3, liquidation_reason = $4 WHERE position_id = $5`,
          [loss, nowMs, nowMs, reasonNote, pos.positionId]
        );

        await this.recordPositionSnapshot(
          {
            positionId: pos.positionId,
            userId: pos.userId,
            instrumentKey: pos.instrumentKey,
            side: pos.side,
            qty: 0,
            avgEntryPrice: pos.avgEntryPrice,
            status: 'Liquidated',
            settlementCurrency: pos.settlementCurrency,
            collateralCurrency: pos.collateralCurrency,
          },
          nowMs,
          nowMs, // End snapshot immediately since it's closed
          client
        );

        const tradeSide = pos.side === 'Long' ? 'Sell' : 'Buy';

        const liqOrderId = 'ord_liq_' + crypto.randomUUID();

        await client.query(
          `INSERT INTO te_orders (order_id, user_id, instrument_key, side, order_type, qty, price, reduce_only, position_effect, status, executed_qty, remaining_qty, avg_fill_price, fee, collateral_currency, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            liqOrderId,
            userId,
            pos.instrumentKey,
            tradeSide,
            'Market',
            closedQty,
            pos.markPrice,
            true,
            'LIQUIDATE',
            'Filled',
            closedQty,
            0,
            pos.markPrice,
            liquidationFee,
            currency,
            nowMs,
            nowMs,
          ]
        );

        // 12. Записать Trade с reason=LIQUIDATION.
        const tradeId = i === 0 && passedTradeId ? passedTradeId : 't_liq_' + crypto.randomUUID();
        const trade = {
          tradeId,
          orderId: liqOrderId,
          userId: userId,
          positionId: pos.positionId,
          instrumentKey: pos.instrumentKey,
          side: tradeSide,
          currency: currency,
          qty: closedQty,
          markPrice: pos.markPrice,
          price: pos.markPrice,
          fee: liquidationFee,
          liquidationFee: liquidationFee,
          realizedPnl: loss,
          feeCurrency: currency,
          pnlCurrency: currency,
          settlementCurrency: currency,
          status: 'EXECUTED',
          reason: reasonNote || 'LIQUIDATION',
          timestamp: nowMs,
        };

        await client.query(
          `INSERT INTO te_trades (trade_id, order_id, user_id, instrument_key, side, qty, price, fee, fee_currency, realized_pnl, pnl_currency, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
            trade.timestamp,
          ]
        );

        lastTradeResult = trade;

        // 14. Записать execution, если liquidation является execution-операцией.
        const executionId =
          i === 0 && passedExecutionId ? passedExecutionId : 'exec_liq_' + crypto.randomUUID();
        await client.query(
          `INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            executionId,
            liqOrderId,
            userId,
            pos.instrumentKey,
            tradeSide,
            closedQty,
            closedQty,
            pos.markPrice,
            liquidationFee,
            currency,
            currency,
            currency,
            'COMPLETED',
            nowMs,
            nowMs,
            'LIQUIDATE',
            null,
          ]
        );

        // 15. Записать outbox events.
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'orderUpdated',
            userId,
            JSON.stringify({
              orderId: liqOrderId,
              userId,
              positionId: pos.positionId,
              instrumentKey: pos.instrumentKey,
              side: tradeSide,
              currency,
              orderType: 'Market',
              qty: closedQty,
              markPrice: pos.markPrice,
              price: pos.markPrice,
              reduceOnly: true,
              positionEffect: 'LIQUIDATE',
              realizedPnl: loss,
              fee: liquidationFee,
              liquidationFee,
              status: 'Filled',
              reason: reasonNote || 'LIQUIDATION',
              executedQty: closedQty,
              remainingQty: 0,
              avgFillPrice: pos.markPrice,
            }),
            'pending',
            currency,
            nowMs,
          ]
        );

        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'positionUpdated',
            userId,
            JSON.stringify({
              ...pos,
              userId,
              positionId: pos.positionId,
              instrumentKey: pos.instrumentKey,
              side: pos.side,
              currency: pos.collateralCurrency || currency,
              qty: pos.qty,
              markPrice: pos.markPrice,
              realizedPnl: pos.realizedPnl,
              fee: liquidationFee,
              liquidationFee,
              status: pos.status,
              reason: pos.liquidationReason || reasonNote || 'LIQUIDATION',
            }),
            'pending',
            currency,
            nowMs,
          ]
        );
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          ['tradeExecuted', userId, JSON.stringify(trade), 'pending', currency, nowMs]
        );

        lastTradeResult = trade;
      }

      // 11. Обновить available balance.
      if (balRes.rows.length > 0) {
        const bal = balRes.rows[0];
        const newBalance = Number(bal.available_balance) + totalRealizedLoss - totalLiquidationFee;
        const finalBalance = newBalance <= 0 ? 0 : newBalance;

        // 10. Освободить locked/used margin.
        const updatedMargin = await this.calculateMargin(client, userId, currency);

        await client.query(
          `UPDATE te_balances SET available_balance = $1, locked_balance = $2, total_fees = total_fees + $3, realized_pnl = realized_pnl + $4, updated_at = $5 WHERE user_id = $6 AND currency = $7`,
          [
            finalBalance,
            updatedMargin.usedMargin,
            totalLiquidationFee,
            totalRealizedLoss,
            nowMs,
            userId,
            currency,
          ]
        );

        const firstPosRow = posRes.rows[0] ? this.mapPosition(posRes.rows[0]) : null;

        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'balanceUpdated',
            userId,
            JSON.stringify({
              userId,
              positionId: firstPosRow?.positionId || null,
              instrumentKey: firstPosRow?.instrumentKey || null,
              side: firstPosRow?.side || null,
              currency,
              qty: firstPosRow?.qty || 0,
              markPrice: firstPosRow?.markPrice || 0,
              realizedPnl: totalRealizedLoss,
              fee: totalLiquidationFee,
              liquidationFee: totalLiquidationFee,
              balance: finalBalance,
              status: 'UPDATED',
              reason: 'LIQUIDATION',
            }),
            'pending',
            currency,
            nowMs,
          ]
        );

        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'ledgerUpdated',
            userId,
            JSON.stringify({
              userId,
              positionId: firstPosRow?.positionId || null,
              instrumentKey: firstPosRow?.instrumentKey || null,
              side: firstPosRow?.side || null,
              currency,
              qty: firstPosRow?.qty || 0,
              markPrice: firstPosRow?.markPrice || 0,
              realizedPnl: totalRealizedLoss,
              fee: totalLiquidationFee,
              liquidationFee: totalLiquidationFee,
              balance: finalBalance,
              status: 'RECORDED',
              reason: 'LIQUIDATION',
            }),
            'pending',
            currency,
            nowMs,
          ]
        );

        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'marginCall',
            userId,
            JSON.stringify({
              userId,
              positionId: firstPosRow?.positionId || null,
              instrumentKey: firstPosRow?.instrumentKey || null,
              side: firstPosRow?.side || null,
              currency,
              qty: firstPosRow?.qty || 0,
              markPrice: firstPosRow?.markPrice || 0,
              realizedPnl: totalRealizedLoss,
              fee: totalLiquidationFee,
              liquidationFee: totalLiquidationFee,
              type: 'liquidation',
              balance: finalBalance,
              status: 'LIQUIDATED',
              reason: 'LIQUIDATION',
            }),
            'pending',
            currency,
            nowMs,
          ]
        );
      }

      if (ownClient) {
        await client.query('COMMIT');
      }

      return lastTradeResult;
    } catch (e) {
      if (ownClient) {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
      }
      throw e;
    } finally {
      if (ownClient) {
        client.release();
      }
    }
  }

  public async createFundingPeriodSnapshot(
    snapshot: {
      instrumentKey: string;
      currency: string;
      fundingInterval?: string;
      fundingTimestamp: number;
      fundingRate: number;
      markPrice: number;
      createdAt?: number;
    },
    clientArg?: any
  ): Promise<FundingPeriodSnapshot> {
    const client = clientArg || (await this.pool.connect());
    const ownClient = !clientArg;
    try {
      const fundingInterval = snapshot.fundingInterval || '8h';
      const createdAt = snapshot.createdAt || Date.now();
      await client.query(
        `INSERT INTO te_funding_periods
          (instrument_key, currency, funding_interval, funding_timestamp, funding_rate, mark_price, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (instrument_key, currency, funding_interval, funding_timestamp)
         DO UPDATE SET funding_rate = EXCLUDED.funding_rate, mark_price = EXCLUDED.mark_price`,
        [
          snapshot.instrumentKey,
          snapshot.currency,
          fundingInterval,
          snapshot.fundingTimestamp,
          snapshot.fundingRate,
          snapshot.markPrice,
          createdAt,
        ]
      );
      return {
        instrumentKey: snapshot.instrumentKey,
        currency: snapshot.currency,
        fundingInterval,
        fundingTimestamp: snapshot.fundingTimestamp,
        fundingRate: snapshot.fundingRate,
        markPrice: snapshot.markPrice,
        createdAt,
      };
    } finally {
      if (ownClient) {
        client.release();
      }
    }
  }

  public async recordPositionSnapshot(
    position: {
      positionId: string;
      userId: string;
      instrumentKey: string;
      side: 'Long' | 'Short' | string;
      qty: number;
      avgEntryPrice: number;
      status: string;
      settlementCurrency?: string;
      collateralCurrency?: string;
    },
    validFrom?: number,
    validTo?: number | null,
    clientArg?: any
  ): Promise<PositionSnapshot> {
    const client = clientArg || (await this.pool.connect());
    const ownClient = !clientArg;
    try {
      const nowMs = validFrom ?? Date.now();
      const snapshotId = 'pos_snap_' + crypto.randomUUID();

      // Close previous snapshot for this position where valid_to IS NULL and valid_from < nowMs
      await client.query(
        `UPDATE te_position_snapshots
         SET valid_to = $1
         WHERE position_id = $2 AND valid_to IS NULL AND valid_from < $1`,
        [nowMs, position.positionId]
      );

      // Insert new snapshot
      await client.query(
        `INSERT INTO te_position_snapshots
          (snapshot_id, position_id, user_id, instrument_key, side, qty, avg_entry_price, status, settlement_currency, collateral_currency, valid_from, valid_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          snapshotId,
          position.positionId,
          position.userId,
          position.instrumentKey,
          position.side,
          position.qty,
          position.avgEntryPrice,
          position.status,
          position.settlementCurrency || null,
          position.collateralCurrency || null,
          nowMs,
          validTo ?? null,
          Date.now(),
        ]
      );

      return {
        snapshotId,
        positionId: position.positionId,
        userId: position.userId,
        instrumentKey: position.instrumentKey,
        side: position.side as 'Long' | 'Short',
        qty: position.qty,
        avgEntryPrice: position.avgEntryPrice,
        status: position.status,
        settlementCurrency: position.settlementCurrency,
        collateralCurrency: position.collateralCurrency,
        validFrom: nowMs,
        validTo: validTo ?? null,
        createdAt: Date.now(),
      };
    } finally {
      if (ownClient) {
        client.release();
      }
    }
  }

  public async getPositionSnapshotAt(
    positionId: string,
    timestamp: number,
    clientArg?: any
  ): Promise<PositionSnapshot | null> {
    const client = clientArg || (await this.pool.connect());
    const ownClient = !clientArg;
    try {
      const res = await client.query(
        `SELECT * FROM te_position_snapshots
         WHERE position_id = $1
           AND valid_from <= $2
           AND (valid_to IS NULL OR valid_to > $2)
         ORDER BY valid_from DESC
         LIMIT 1`,
        [positionId, timestamp]
      );
      if (res.rows.length === 0) {
        return null;
      }
      const row = res.rows[0];
      return {
        snapshotId: row.snapshot_id,
        positionId: row.position_id,
        userId: row.user_id,
        instrumentKey: row.instrument_key,
        side: row.side as 'Long' | 'Short',
        qty: Number(row.qty),
        avgEntryPrice: Number(row.avg_entry_price),
        status: row.status,
        settlementCurrency: row.settlement_currency || undefined,
        collateralCurrency: row.collateral_currency || undefined,
        validFrom: Number(row.valid_from),
        validTo: row.valid_to ? Number(row.valid_to) : null,
        createdAt: Number(row.created_at),
      };
    } finally {
      if (ownClient) {
        client.release();
      }
    }
  }

  public async getFundingPeriodSnapshot(
    instrumentKey: string,
    currency: string,
    fundingInterval: string,
    fundingTimestamp: number,
    clientArg?: any
  ): Promise<FundingPeriodSnapshot | null> {
    const client = clientArg || (await this.pool.connect());
    const ownClient = !clientArg;
    try {
      const res = await client.query(
        `SELECT * FROM te_funding_periods
         WHERE instrument_key = $1 AND currency = $2 AND funding_interval = $3 AND funding_timestamp = $4`,
        [instrumentKey, currency, fundingInterval, fundingTimestamp]
      );
      if (res.rows.length === 0) {
        return null;
      }
      const row = res.rows[0];
      return {
        instrumentKey: row.instrument_key,
        currency: row.currency,
        fundingInterval: row.funding_interval,
        fundingTimestamp: Number(row.funding_timestamp),
        fundingRate: Number(row.funding_rate),
        markPrice: Number(row.mark_price),
        createdAt: Number(row.created_at),
      };
    } finally {
      if (ownClient) {
        client.release();
      }
    }
  }

  public async applyFundingRate(
    clientArg: any,
    options: ProcessFundingOptions
  ): Promise<FundingPayment[]> {
    let client = clientArg;
    let ownClient = false;
    if (!client) {
      client = await this.pool.connect();
      ownClient = true;
    }

    try {
      if (ownClient) {
        await client.query('BEGIN');
      }

      const fundingInterval = options.fundingInterval || '8h';
      const fundingTimestamp = options.fundingTimestamp || Date.now();

      if (options.fundingRate != null) {
        if (
          typeof options.fundingRate !== 'number' ||
          isNaN(options.fundingRate) ||
          !Number.isFinite(options.fundingRate)
        ) {
          throw new Error('Invalid fundingRate: must be a valid finite number');
        }
        if (Math.abs(options.fundingRate) > 1.0) {
          throw new Error(
            `Invalid fundingRate (${options.fundingRate}): exceeds maximum allowed range [-1.0, 1.0]`
          );
        }
      }

      let queryStr = `SELECT * FROM te_positions WHERE status IN ('Open', 'MarginCall', 'OPEN', 'MARGIN_CALL') AND qty > 0`;
      const queryParams: any[] = [];

      if (options.positionId) {
        queryParams.push(options.positionId);
        queryStr += ` AND position_id = $${queryParams.length}`;
      }
      if (options.userId) {
        queryParams.push(options.userId);
        queryStr += ` AND user_id = $${queryParams.length}`;
      }
      if (options.instrumentKey) {
        queryParams.push(options.instrumentKey);
        queryStr += ` AND instrument_key = $${queryParams.length}`;
      }
      if (options.currency && !options.positionId) {
        queryParams.push(options.currency);
        queryStr += ` AND (collateral_currency = $${queryParams.length} OR settlement_currency = $${queryParams.length} OR (collateral_currency IS NULL AND settlement_currency IS NULL AND (instrument_key = $${queryParams.length} OR instrument_key LIKE $${queryParams.length} || '-%')))`;
      }

      queryStr += ` FOR UPDATE`;

      const posRes = await client.query(queryStr, queryParams);
      const results: FundingPayment[] = [];

      if (posRes.rows.length === 0 && options.positionId) {
        const dupCheck = await client.query(
          `SELECT * FROM te_funding_payments WHERE position_id = $1 AND funding_timestamp = $2`,
          [options.positionId, fundingTimestamp]
        );
        if (dupCheck.rows.length > 0) {
          const row = dupCheck.rows[0];
          const existingPayment: FundingPayment = {
            fundingId: row.funding_id,
            positionId: row.position_id,
            userId: row.user_id,
            instrumentKey: row.instrument_key,
            currency: row.currency,
            side: row.side as 'Long' | 'Short',
            fundingRate: Number(row.funding_rate),
            fundingInterval: row.funding_interval,
            fundingTimestamp: Number(row.funding_timestamp),
            markPrice: Number(row.mark_price),
            qty: Number(row.qty),
            notional: Number(row.notional),
            fundingAmount: Number(row.funding_amount),
            status: row.status,
            createdAt: Number(row.created_at),
            processedAt: Number(row.processed_at),
          };

          if (options.currency && existingPayment.currency !== options.currency) {
            throw new Error(
              `Funding conflict: Existing funding payment currency (${existingPayment.currency}) does not match requested currency (${options.currency})`
            );
          }
          if (
            options.fundingRate != null &&
            Math.abs(existingPayment.fundingRate - options.fundingRate) > 1e-8
          ) {
            throw new Error(
              `Funding conflict: Existing funding rate (${existingPayment.fundingRate}) does not match requested rate (${options.fundingRate})`
            );
          }

          results.push(existingPayment);
        }
      }

      for (const posRow of posRes.rows) {
        const position = this.mapPosition(posRow);
        const posCurrency = position.collateralCurrency || position.settlementCurrency;
        if (
          !posCurrency ||
          String(posCurrency).trim() === '' ||
          posCurrency === 'undefined' ||
          posCurrency === 'null'
        ) {
          throw new Error(`Funding error: Position ${position.positionId} has missing currency`);
        }
        if (posCurrency !== 'TON' && posCurrency !== 'STARS') {
          throw new Error(
            `Funding error: Position ${position.positionId} has unsupported currency '${posCurrency}'`
          );
        }
        if (options.currency && options.currency !== posCurrency) {
          throw new Error(
            `Funding error: Position ${position.positionId} currency '${posCurrency}' does not match requested currency '${options.currency}'`
          );
        }

        if (options.fundingRate != null) {
          if (
            typeof options.fundingRate !== 'number' ||
            isNaN(options.fundingRate) ||
            !Number.isFinite(options.fundingRate)
          ) {
            throw new Error('Invalid fundingRate: must be a valid finite number');
          }
          if (Math.abs(options.fundingRate) > 1.0) {
            throw new Error(
              `Invalid fundingRate (${options.fundingRate}): exceeds maximum allowed range [-1.0, 1.0]`
            );
          }
        }

        // Lookup historical snapshot in te_funding_periods
        const snapshot = await this.getFundingPeriodSnapshot(
          position.instrumentKey,
          posCurrency,
          fundingInterval,
          fundingTimestamp,
          client
        );

        let effectiveFundingRate: number;
        let effectiveMarkPrice: number;

        if (snapshot) {
          if (
            options.fundingRate != null &&
            Math.abs(snapshot.fundingRate - options.fundingRate) > 1e-8
          ) {
            throw new Error(
              `Funding conflict: Existing funding rate (${snapshot.fundingRate}) does not match requested rate (${options.fundingRate})`
            );
          }
          effectiveFundingRate = snapshot.fundingRate;
          effectiveMarkPrice = snapshot.markPrice;
        } else if (options.overrideMarkPrice != null && options.fundingRate != null) {
          effectiveFundingRate = options.fundingRate;
          effectiveMarkPrice = options.overrideMarkPrice;
          await this.createFundingPeriodSnapshot(
            {
              instrumentKey: position.instrumentKey,
              currency: posCurrency,
              fundingInterval,
              fundingTimestamp,
              fundingRate: effectiveFundingRate,
              markPrice: effectiveMarkPrice,
            },
            client
          );
        } else if (!options.isCatchUp) {
          if (options.fundingRate == null) {
            throw new Error('Invalid fundingRate: must be a valid finite number');
          }
          effectiveFundingRate = options.fundingRate;
          effectiveMarkPrice =
            options.overrideMarkPrice != null
              ? options.overrideMarkPrice
              : position.markPrice != null && position.markPrice > 0
                ? position.markPrice
                : position.avgEntryPrice;
          await this.createFundingPeriodSnapshot(
            {
              instrumentKey: position.instrumentKey,
              currency: posCurrency,
              fundingInterval,
              fundingTimestamp,
              fundingRate: effectiveFundingRate,
              markPrice: effectiveMarkPrice,
            },
            client
          );
        } else {
          throw new Error(
            `MISSING_HISTORICAL_SNAPSHOT: No funding period snapshot found for instrument '${position.instrumentKey}', currency '${posCurrency}', interval '${fundingInterval}', timestamp ${fundingTimestamp}`
          );
        }

        if (
          typeof effectiveFundingRate !== 'number' ||
          isNaN(effectiveFundingRate) ||
          !Number.isFinite(effectiveFundingRate)
        ) {
          throw new Error('Invalid fundingRate: must be a valid finite number');
        }

        if (Math.abs(effectiveFundingRate) > 1.0) {
          throw new Error(
            `Invalid fundingRate (${effectiveFundingRate}): exceeds maximum allowed range [-1.0, 1.0]`
          );
        }

        const fundingRate = Number(effectiveFundingRate.toFixed(8));
        const markPrice = effectiveMarkPrice;

        // Check if funding payment already exists for this position & timestamp (idempotency check)
        const dupCheck = await client.query(
          `SELECT * FROM te_funding_payments WHERE position_id = $1 AND funding_timestamp = $2`,
          [position.positionId, fundingTimestamp]
        );

        if (dupCheck.rows.length > 0) {
          const row = dupCheck.rows[0];
          const existingPayment: FundingPayment = {
            fundingId: row.funding_id,
            positionId: row.position_id,
            userId: row.user_id,
            instrumentKey: row.instrument_key,
            currency: row.currency,
            side: row.side as 'Long' | 'Short',
            fundingRate: Number(row.funding_rate),
            fundingInterval: row.funding_interval,
            fundingTimestamp: Number(row.funding_timestamp),
            markPrice: Number(row.mark_price),
            qty: Number(row.qty),
            notional: Number(row.notional),
            fundingAmount: Number(row.funding_amount),
            status: row.status,
            createdAt: Number(row.created_at),
            processedAt: Number(row.processed_at),
          };

          const currentQty = position.qty;
          const currentMarkPrice = markPrice;
          const currentCurrency = posCurrency;
          const currentRate = fundingRate;

          const rateDiff = Math.abs(existingPayment.fundingRate - currentRate);
          const priceDiff = Math.abs(existingPayment.markPrice - currentMarkPrice);
          const qtyDiff = Math.abs(existingPayment.qty - currentQty);
          const currencyMismatch = existingPayment.currency !== currentCurrency;

          if (rateDiff > 1e-8 || priceDiff > 1e-8 || qtyDiff > 1e-8 || currencyMismatch) {
            throw new Error(
              `Funding conflict: Existing funding payment for position ${position.positionId} at timestamp ${fundingTimestamp} has different parameters`
            );
          }

          results.push(existingPayment);
          continue;
        }

        // Do not process funding for positions opened after the funding timestamp
        if (position.openedAt && position.openedAt > fundingTimestamp) {
          continue;
        }

        let qty = position.qty;
        if (options.isCatchUp) {
          const posSnapshot = await this.getPositionSnapshotAt(
            position.positionId,
            fundingTimestamp,
            client
          );
          if (posSnapshot) {
            qty = posSnapshot.qty;
            if (qty <= 0) continue; // Skip if position was closed at that time
          } else {
            throw new Error(
              `MISSING_HISTORICAL_QTY: No position snapshot found for position ${position.positionId} at timestamp ${fundingTimestamp}`
            );
          }
        }

        const notional = qty * markPrice;

        // Long pays when fundingRate > 0 (fundingAmount > 0)
        // Short receives when fundingRate > 0 (fundingAmount < 0)
        let fundingAmount = 0;
        if (position.side === 'Long') {
          fundingAmount = notional * fundingRate;
        } else {
          fundingAmount = -(notional * fundingRate);
        }

        // Lock & update user balance
        const balRes = await client.query(
          `SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
          [position.userId, posCurrency]
        );

        let currentBalance = 0;
        if (balRes.rows.length > 0) {
          currentBalance = Number(balRes.rows[0].available_balance);
        } else {
          await client.query(
            `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, updated_at) VALUES ($1, $2, $3, 0, $4)`,
            [position.userId, posCurrency, 0, Date.now()]
          );
        }

        let newAvailableBalance = currentBalance - fundingAmount;
        let paymentStatus: 'PROCESSED' | 'FAILED' = 'PROCESSED';
        let errorReason: string | undefined = undefined;

        if (newAvailableBalance < 0 && fundingAmount > 0) {
          paymentStatus = 'FAILED';
          errorReason = 'INSUFFICIENT_MARGIN';
          // Do not deduct partial sum, keep current balance
          newAvailableBalance = currentBalance;
        }

        if (paymentStatus === 'PROCESSED') {
          await client.query(
            `UPDATE te_balances SET available_balance = $1, updated_at = $2 WHERE user_id = $3 AND currency = $4`,
            [newAvailableBalance, Date.now(), position.userId, posCurrency]
          );
        } else if (paymentStatus === 'FAILED') {
          // Pass state to existing margin-call logic
          const newStatus = 'MarginCall';
          await client.query('UPDATE te_positions SET status = $1 WHERE position_id = $2', [
            newStatus,
            position.positionId,
          ]);
          await client.query(
            'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [
              'marginCall',
              position.userId,
              JSON.stringify({
                userId: position.userId,
                instrumentKey: position.instrumentKey,
                status: newStatus,
              }),
              'pending',
              posCurrency,
              Date.now(),
            ]
          );
        }

        const fundingId = 'funding_' + crypto.randomUUID();
        const nowMs = Date.now();

        await client.query(
          `INSERT INTO te_funding_payments 
            (funding_id, position_id, user_id, instrument_key, currency, side, funding_rate, funding_interval, funding_timestamp, mark_price, qty, notional, funding_amount, status, created_at, processed_at, error_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            fundingId,
            position.positionId,
            position.userId,
            position.instrumentKey,
            posCurrency,
            position.side,
            fundingRate,
            fundingInterval,
            fundingTimestamp,
            markPrice,
            qty,
            notional,
            fundingAmount,
            paymentStatus,
            nowMs,
            nowMs,
            errorReason || null,
          ]
        );

        const payment: FundingPayment = {
          fundingId,
          positionId: position.positionId,
          userId: position.userId,
          instrumentKey: position.instrumentKey,
          currency: posCurrency,
          side: position.side as 'Long' | 'Short',
          fundingRate,
          fundingInterval,
          fundingTimestamp,
          markPrice,
          qty,
          notional,
          fundingAmount,
          status: paymentStatus,
          errorReason,
          createdAt: nowMs,
          processedAt: nowMs,
        };

        const commonPayload = {
          userId: position.userId,
          positionId: position.positionId,
          instrumentKey: position.instrumentKey,
          side: position.side,
          currency: posCurrency,
          fundingRate,
          fundingAmount,
          fundingTimestamp,
          markPrice,
          availableBalance: newAvailableBalance,
          status: paymentStatus,
          errorReason,
        };

        // Outbox event: fundingUpdated (will reflect FAILED if it failed)
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'fundingUpdated',
            position.userId,
            JSON.stringify({ ...payment, ...commonPayload }),
            'pending',
            posCurrency,
            nowMs,
          ]
        );

        if (paymentStatus === 'PROCESSED') {
          // Outbox event: fundingProcessed (backwards compatibility)
          await client.query(
            `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              'fundingProcessed',
              position.userId,
              JSON.stringify({ ...payment, ...commonPayload }),
              'pending',
              posCurrency,
              nowMs,
            ]
          );

          // Outbox event: balanceUpdated
          await client.query(
            `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              'balanceUpdated',
              position.userId,
              JSON.stringify({
                ...commonPayload,
                previousBalance: currentBalance,
                availableBalance: newAvailableBalance,
              }),
              'pending',
              posCurrency,
              nowMs,
            ]
          );

          // Outbox event: ledgerUpdated
          await client.query(
            `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              'ledgerUpdated',
              position.userId,
              JSON.stringify({
                ...commonPayload,
                ledgerType: 'FUNDING',
                amount: fundingAmount,
              }),
              'pending',
              posCurrency,
              nowMs,
            ]
          );
        }

        // Outbox event: positionUpdated (only if position fields or financial snapshot changed)
        if (fundingAmount !== 0 || position.markPrice !== markPrice) {
          await client.query(
            `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              'positionUpdated',
              position.userId,
              JSON.stringify({
                ...commonPayload,
                qty: position.qty,
                avgEntryPrice: position.avgEntryPrice,
                unrealizedPnl: position.unrealizedPnl,
                realizedPnl: position.realizedPnl,
                positionStatus: position.status,
              }),
              'pending',
              posCurrency,
              nowMs,
            ]
          );
        }

        results.push(payment);
      }

      if (ownClient) {
        await client.query('COMMIT');
      }

      return results;
    } catch (e) {
      if (ownClient) {
        try {
          await client.query('ROLLBACK');
        } catch (e) {}
      }
      throw e;
    } finally {
      if (ownClient) {
        client.release();
      }
    }
  }

  public async getFundingPayments(userId: string): Promise<FundingPayment[]> {
    const res = await this.pool.query(
      `SELECT * FROM te_funding_payments WHERE user_id = $1 ORDER BY funding_timestamp DESC`,
      [userId]
    );
    return res.rows.map((r) => ({
      fundingId: r.funding_id,
      positionId: r.position_id,
      userId: r.user_id,
      instrumentKey: r.instrument_key,
      currency: r.currency,
      side: r.side,
      fundingRate: Number(r.funding_rate),
      fundingInterval: r.funding_interval,
      fundingTimestamp: Number(r.funding_timestamp),
      markPrice: Number(r.mark_price),
      qty: Number(r.qty),
      notional: Number(r.notional),
      fundingAmount: Number(r.funding_amount),
      status: r.status,
      createdAt: Number(r.created_at),
      processedAt: Number(r.processed_at),
      errorReason: r.error_reason || undefined,
    }));
  }

  /**
   * Variant A: Catch-up worker for missed funding periods upon engine restart.
   * Finds all missed discrete funding timestamps between lastProcessedTimestamp + intervalMs
   * and currentTimestamp, and processes them sequentially in strict chronological order.
   */
  public async processMissedFundingPeriods(options: {
    lastProcessedTimestamp?: number;
    currentTimestamp?: number;
    intervalMs: number;
    fundingRate?: number;
    overrideMarkPrice?: number;
    fundingInterval?: string;
    currency?: string;
    instrumentKey?: string;
  }): Promise<
    {
      timestamp: number;
      payments: FundingPayment[];
      status?: 'PROCESSED' | 'SKIPPED';
      errorReason?: string;
    }[]
  > {
    const endTs = options.currentTimestamp || Date.now();
    const intervalMs = options.intervalMs;
    if (intervalMs <= 0) {
      throw new Error('intervalMs must be positive');
    }

    const fundingInterval = options.fundingInterval || '8h';

    // 1. Fetch active open positions matching optional instrument/currency filters
    let queryStr = `SELECT * FROM te_positions WHERE status IN ('Open', 'MarginCall', 'OPEN', 'MARGIN_CALL') AND qty > 0`;
    const queryParams: any[] = [];

    if (options.instrumentKey) {
      queryParams.push(options.instrumentKey);
      queryStr += ` AND instrument_key = $${queryParams.length}`;
    }
    if (options.currency) {
      queryParams.push(options.currency);
      queryStr += ` AND (collateral_currency = $${queryParams.length} OR settlement_currency = $${queryParams.length})`;
    }

    const posRes = await this.pool.query(queryStr, queryParams);
    const openPositions = posRes.rows.map((r) => this.mapPosition(r));

    // Map timestamp -> array of positionIds that need funding at that timestamp
    const timestampToPositionsMap = new Map<number, string[]>();

    for (const pos of openPositions) {
      const posCurrency = pos.collateralCurrency || pos.settlementCurrency;
      if (!posCurrency || posCurrency === 'undefined' || posCurrency === 'null') {
        continue;
      }

      // Query max funding_timestamp specifically for this position_id, instrument_key, currency, and funding_interval
      const maxRes = await this.pool.query(
        `SELECT MAX(funding_timestamp) as max_ts
         FROM te_funding_payments
         WHERE position_id = $1
           AND instrument_key = $2
           AND currency = $3
           AND funding_interval = $4`,
        [pos.positionId, pos.instrumentKey, posCurrency, fundingInterval]
      );

      let posLastTs: number;
      if (maxRes.rows.length > 0 && maxRes.rows[0].max_ts != null) {
        posLastTs = Number(maxRes.rows[0].max_ts);
      } else if (options.lastProcessedTimestamp != null) {
        posLastTs = options.lastProcessedTimestamp;
      } else if (pos.openedAt != null && pos.openedAt < endTs) {
        posLastTs = pos.openedAt;
      } else {
        posLastTs = endTs - intervalMs;
      }

      let curTs = posLastTs + intervalMs;
      while (curTs <= endTs) {
        if (!timestampToPositionsMap.has(curTs)) {
          timestampToPositionsMap.set(curTs, []);
        }
        timestampToPositionsMap.get(curTs)!.push(pos.positionId);
        curTs += intervalMs;
      }
    }

    // Fallback if no open position needed funding but explicit lastProcessedTimestamp was provided
    if (timestampToPositionsMap.size === 0 && options.lastProcessedTimestamp != null) {
      let curTs = options.lastProcessedTimestamp + intervalMs;
      while (curTs <= endTs) {
        timestampToPositionsMap.set(curTs, []);
        curTs += intervalMs;
      }
    }

    // Get sorted discrete timestamps in strict chronological order
    const sortedTimestamps = Array.from(timestampToPositionsMap.keys()).sort((a, b) => a - b);
    const results: {
      timestamp: number;
      payments: FundingPayment[];
      status?: 'PROCESSED' | 'SKIPPED';
      errorReason?: string;
    }[] = [];

    for (const ts of sortedTimestamps) {
      const targetPosIds = timestampToPositionsMap.get(ts)!;
      const paymentsAtTs: FundingPayment[] = [];
      let periodStatus: 'PROCESSED' | 'SKIPPED' = 'PROCESSED';
      let periodErrorReason: string | undefined = undefined;

      if (targetPosIds.length === 0) {
        try {
          const payments = await this.applyFundingRate(null, {
            fundingRate: options.fundingRate,
            overrideMarkPrice: options.overrideMarkPrice,
            fundingTimestamp: ts,
            fundingInterval,
            currency: options.currency,
            instrumentKey: options.instrumentKey,
            isCatchUp: true,
          });
          paymentsAtTs.push(...payments);
        } catch (err: any) {
          if (
            err.message &&
            (err.message.includes('MISSING_HISTORICAL_SNAPSHOT') ||
              err.message.includes('MISSING_HISTORICAL_QTY'))
          ) {
            periodStatus = 'SKIPPED';
            periodErrorReason = err.message;
          } else {
            throw err;
          }
        }
      } else {
        for (const posId of targetPosIds) {
          try {
            const payments = await this.applyFundingRate(null, {
              fundingRate: options.fundingRate,
              overrideMarkPrice: options.overrideMarkPrice,
              fundingTimestamp: ts,
              fundingInterval,
              currency: options.currency,
              instrumentKey: options.instrumentKey,
              positionId: posId,
              isCatchUp: true,
            });
            paymentsAtTs.push(...payments);
          } catch (err: any) {
            if (
              err.message &&
              (err.message.includes('MISSING_HISTORICAL_SNAPSHOT') ||
                err.message.includes('MISSING_HISTORICAL_QTY'))
            ) {
              periodStatus = 'SKIPPED';
              periodErrorReason = err.message;
            } else {
              throw err;
            }
          }
        }
      }

      results.push({
        timestamp: ts,
        payments: paymentsAtTs,
        status: periodStatus,
        errorReason: periodErrorReason,
      });
    }

    return results;
  }
}

/**
 * Managed Funding Worker for scheduled and simulation-based funding execution.
 * Controls timer lifecycle without uncontrolled background execution on import.
 */
export class FundingWorker {
  private engine: PostgresTradingEngine;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private fundingRateProvider: () => number;

  constructor(
    engine: PostgresTradingEngine,
    options?: { intervalMs?: number; fundingRateProvider?: () => number }
  ) {
    this.engine = engine;
    this.intervalMs = options?.intervalMs ?? 28800000; // default 8h
    this.fundingRateProvider = options?.fundingRateProvider ?? (() => 0.0001);
  }

  public async start(catchUp: boolean = true): Promise<void> {
    if (this.isRunning) {
      console.log('FundingWorker is already running. Skipping duplicate start.');
      return;
    }
    this.isRunning = true;

    if (catchUp) {
      try {
        await this.engine.processMissedFundingPeriods({
          intervalMs: this.intervalMs,
          fundingRate: this.fundingRateProvider(),
        });
      } catch (err) {
        console.error('Error during funding catch-up on start:', err);
      }
    }

    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const rate = this.fundingRateProvider();
        await this.engine.applyFundingRate(null, {
          fundingRate: rate,
          fundingTimestamp: Date.now(),
        });
      } catch (err) {
        console.error('Error during scheduled funding execution:', err);
      }
    }, this.intervalMs);
  }

  public async tick(overrideTimestamp?: number): Promise<FundingPayment[]> {
    if (!this.isRunning) {
      throw new Error('FundingWorker is not running');
    }
    const rate = this.fundingRateProvider();
    return await this.engine.applyFundingRate(null, {
      fundingRate: rate,
      fundingTimestamp: overrideTimestamp || Date.now(),
    });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public getStatus(): { isRunning: boolean; intervalMs: number } {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
    };
  }
}
