import Decimal from 'decimal.js';
import { Pool, PoolClient } from 'pg';
import { getInstrumentConfig } from './instrumentConfig';
import { mapPosition, mapOrder, mapTrade } from './mappers';
import { calculateMargin } from './balanceManager';
import { recordPositionSnapshot } from './positionManager';
import * as crypto from 'crypto';

export async function liquidateUser(
  pool: Pool,
  clientArg: PoolClient | any,
  userId: string,
  currency: string,
  executionIdOrOptions?: string | { executionId?: string; tradeId?: string },
  tradeIdParam?: string
): Promise<any> {
  let client = clientArg;
  let ownClient = false;
  if (!client) {
    client = await pool.connect();
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
          return mapTrade(tradeRes.rows[0]);
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
        return mapTrade(tradeCheck.rows[0]);
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
          if (tradeRes.rows.length > 0) return mapTrade(tradeRes.rows[0]);
          return execCheck.rows[0];
        }
      }
      if (passedTradeId) {
        const tradeCheck = await client.query('SELECT * FROM te_trades WHERE trade_id = $1', [
          passedTradeId,
        ]);
        if (tradeCheck.rows.length > 0) {
          if (ownClient) await client.query('COMMIT');
          return mapTrade(tradeCheck.rows[0]);
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
      const order = mapOrder(row);
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
    const marginInfo = await calculateMargin(client, userId, currency);

    // 5. Если условие liquidation больше не выполняется, отменить liquidation без изменения баланса.
    if (marginInfo.equity > marginInfo.maintenanceMargin) {
      if (ownClient) await client.query('COMMIT');
      return null;
    }

    let totalRealizedLoss = 0;
    let totalRealizedLossDec = new Decimal(0);
    let totalLiquidationFee = 0;
    let totalLiquidationFeeDec = new Decimal(0);
    let remainingEquity = marginInfo.equity;
    let lastTradeResult: any = null;

    for (let i = 0; i < posRes.rows.length; i++) {
      const row = posRes.rows[i];
      const pos = mapPosition(row);

      const config = getInstrumentConfig(pos.instrumentKey);

      // 6. Рассчитать финальный PnL по стороне позиции.
      const pnlMultiplier = pos.side === 'Long' ? 1 : -1;
      const unrealizedPnl = (pos.markPrice - pos.avgEntryPrice) * pos.qty * pnlMultiplier;
      const loss = unrealizedPnl;
      totalRealizedLoss += loss;
      totalRealizedLossDec = totalRealizedLossDec.plus(new Decimal(loss));

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
      totalLiquidationFeeDec = totalLiquidationFeeDec.plus(new Decimal(liquidationFee));

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

      await recordPositionSnapshot(
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
      const availableBeforeDec = new Decimal(bal.available_balance);
      const lockedBeforeDec = new Decimal(bal.locked_balance || 0);
      const newBalanceDec = availableBeforeDec
        .plus(totalRealizedLossDec)
        .minus(totalLiquidationFeeDec);
      const finalBalanceDec = newBalanceDec.lte(0) ? new Decimal(0) : newBalanceDec;

      const newBalance = newBalanceDec.toNumber();
      const finalBalance = finalBalanceDec.toNumber();

      // 10. Освободить locked/used margin.
      const updatedMargin = await calculateMargin(client, userId, currency);

      await client.query(
        `UPDATE te_balances SET available_balance = $1, locked_balance = $2, total_fees = total_fees + $3, realized_pnl = realized_pnl + $4, updated_at = $5 WHERE user_id = $6 AND currency = $7`,
        [
          finalBalanceDec.toString(),
          (updatedMargin.usedMarginDec || new Decimal(updatedMargin.usedMargin)).toString(),
          totalLiquidationFeeDec.toString(),
          totalRealizedLossDec.toString(),
          nowMs,
          userId,
          currency,
        ]
      );

      await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'LIQUIDATION',
          userId,
          `liq_${nowMs}`,
          currency,
          totalRealizedLossDec.minus(totalLiquidationFeeDec).abs().toString(),
          availableBeforeDec.toString(),
          finalBalanceDec.toString(),
          lockedBeforeDec.toString(),
          (updatedMargin.usedMarginDec || new Decimal(updatedMargin.usedMargin)).toString(),
          JSON.stringify({
            totalRealizedLoss: totalRealizedLossDec.toString(),
            totalLiquidationFee: totalLiquidationFeeDec.toString(),
          }),
          nowMs,
        ]
      );

      const firstPosRow = posRes.rows[0] ? mapPosition(posRes.rows[0]) : null;

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
