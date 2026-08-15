const fs = require('fs');

let content = fs.readFileSync('server/tradingEngine.ts', 'utf8');

const liquidateUserRegex = /public async liquidateUser\([\s\S]*?(?=^\}$)/m;
const newLiquidateUser = `public async liquidateUser(client: any, userId: string, currency: string) {
    const nowMs = Date.now();
    
    // 1. Проверить позицию. Заблокировать Position через FOR UPDATE.
    const posRes = await client.query(
      \`SELECT * FROM te_positions WHERE user_id = $1 AND collateral_currency = $2 AND status IN ('Open', 'MarginCall') FOR UPDATE\`,
      [userId, currency]
    );

    if (posRes.rows.length === 0) return; // Если позиция уже закрыта или ликвидирована, не выполнять liquidation повторно.

    // 2. Заблокировать соответствующий валютный Balance через FOR UPDATE.
    const balRes = await client.query(
      \`SELECT * FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE\`,
      [userId, currency]
    );

    // Cancel all open orders for this currency (frees up margin)
    const ordRes = await client.query(
      \`SELECT * FROM te_orders WHERE user_id = $1 AND collateral_currency = $2 AND status IN ('Open', 'PartiallyFilled') FOR UPDATE\`,
      [userId, currency]
    );
    for (const row of ordRes.rows) {
      const order = this.mapOrder(row);
      order.status = 'Cancelled';
      order.updatedAt = nowMs;
      await client.query(
        \`UPDATE te_orders SET status = 'Cancelled', updated_at = $1 WHERE order_id = $2\`,
        [nowMs, order.orderId]
      );
      await client.query(
        \`INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)\`,
        ['orderCancelled', userId, JSON.stringify(order), 'pending', currency, nowMs]
      );
    }

    // 3 & 4. Повторно прочитать актуальный markPrice. Повторно проверить liquidation condition внутри транзакции.
    const marginInfo = await this.calculateMargin(client, userId, currency);

    // 5. Если условие liquidation больше не выполняется, отменить liquidation без изменения баланса.
    if (marginInfo.equity > marginInfo.maintenanceMargin) {
      return;
    }

    let totalRealizedLoss = 0;
    let totalLiquidationFee = 0;
    let remainingEquity = marginInfo.equity;
    
    for (const row of posRes.rows) {
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
      pos.status = 'Liquidated';
      pos.qty = 0;
      pos.realizedPnl += loss;
      pos.unrealizedPnl = 0;
      pos.liquidationTimestamp = nowMs;
      pos.liquidationReason = reasonNote;
      
      await client.query(
        \`UPDATE te_positions SET status = 'Liquidated', qty = 0, realized_pnl = realized_pnl + $1, unrealized_pnl = 0, updated_at = $2, liquidation_timestamp = $3, liquidation_reason = $4 WHERE position_id = $5\`,
        [loss, nowMs, nowMs, reasonNote, pos.positionId]
      );

      // 12. Записать Trade с reason=LIQUIDATION.
      const tradeId = 't_liq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const tradeSide = pos.side === 'Long' ? 'Sell' : 'Buy';
      const trade = {
        tradeId,
        orderId: 'LIQUIDATION',
        userId: userId,
        instrumentKey: pos.instrumentKey,
        side: tradeSide,
        qty: closedQty,
        price: pos.markPrice,
        fee: liquidationFee,
        feeCurrency: currency,
        realizedPnl: loss,
        pnlCurrency: currency,
        timestamp: nowMs
      };
      
      await client.query(
        \`INSERT INTO te_trades (trade_id, order_id, user_id, instrument_key, side, qty, price, fee, fee_currency, realized_pnl, pnl_currency, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)\`,
        [trade.tradeId, trade.orderId, trade.userId, trade.instrumentKey, trade.side, trade.qty, trade.price, trade.fee, trade.feeCurrency, trade.realizedPnl, trade.pnlCurrency, trade.timestamp]
      );

      // 14. Записать execution, если liquidation является execution-операцией.
      const executionId = 'exec_liq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      await client.query(
        \`INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)\`,
        [
          executionId,
          'LIQUIDATION',
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
          'LIQUIDATION',
          null
        ]
      );

      // 15. Записать outbox events.
      await client.query(
        \`INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)\`,
        ['positionUpdated', userId, JSON.stringify(pos), 'pending', currency, nowMs]
      );
      await client.query(
        \`INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)\`,
        ['tradeExecuted', userId, JSON.stringify(trade), 'pending', currency, nowMs]
      );
    }
    
    // 11. Обновить available balance.
    if (balRes.rows.length > 0) {
      const bal = balRes.rows[0];
      const newBalance = Number(bal.available_balance) + totalRealizedLoss - totalLiquidationFee;
      
      // 10. Освободить locked/used margin.
      const updatedMargin = await this.calculateMargin(client, userId, currency);

      // 13. Записать ledger/history entry. (We update balances which reflects the ledger, we can also emit history if needed)
      await client.query(
        \`UPDATE te_balances SET available_balance = $1, locked_balance = $2, total_fees = total_fees + $3, realized_pnl = realized_pnl + $4, updated_at = $5 WHERE user_id = $6 AND currency = $7\`,
        [newBalance <= 0 ? 0 : newBalance, updatedMargin.usedMargin, totalLiquidationFee, totalRealizedLoss, nowMs, userId, currency]
      );
      
      await client.query(
        \`INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)\`,
        ['balanceUpdated', userId, JSON.stringify({ userId, currency, balance: newBalance <= 0 ? 0 : newBalance }), 'pending', currency, nowMs]
      );
      await client.query(
        \`INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)\`,
        ['marginCall', userId, JSON.stringify({ userId, currency, type: 'liquidation', balance: newBalance <= 0 ? 0 : newBalance }), 'pending', currency, nowMs]
      );
    }
  }
`;

content = content.replace(liquidateUserRegex, newLiquidateUser);
fs.writeFileSync('server/tradingEngine.ts', content);
console.log('liquidateUser successfully updated with fee limits');
