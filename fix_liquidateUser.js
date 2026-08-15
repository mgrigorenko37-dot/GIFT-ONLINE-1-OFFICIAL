const fs = require('fs');

let content = fs.readFileSync('server/tradingEngine.ts', 'utf8');

const liquidateUserRegex = /public async liquidateUser\([\s\S]*?(?=^\}$)/m;
const newLiquidateUser = `public async liquidateUser(client: any, userId: string, currency: string) {
    const nowMs = Date.now();
    
    // 1. Cancel all open orders for this currency
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

    // 2. Liquidate all open positions
    const posRes = await client.query(
      \`SELECT * FROM te_positions WHERE user_id = $1 AND collateral_currency = $2 AND status IN ('Open', 'OPEN', 'MarginCall', 'MARGIN_CALL') FOR UPDATE\`,
      [userId, currency]
    );
    let totalRealizedLoss = 0;
    let totalLiquidationFee = 0;
    for (const row of posRes.rows) {
      const pos = this.mapPosition(row);
      const loss = pos.unrealizedPnl;
      totalRealizedLoss += loss;
      
      const config = getInstrumentConfig(pos.instrumentKey);
      const notional = pos.qty * pos.markPrice;
      const liquidationFee = notional * config.liquidationFeeRate;
      totalLiquidationFee += liquidationFee;
      
      pos.status = 'LIQUIDATED' as any;
      pos.qty = 0;
      pos.realizedPnl += loss;
      pos.unrealizedPnl = 0;
      pos.liquidationTimestamp = nowMs;
      pos.liquidationReason = 'Margin call';
      
      await client.query(
        \`UPDATE te_positions SET status = 'LIQUIDATED', qty = 0, realized_pnl = realized_pnl + $1, unrealized_pnl = 0, updated_at = $2, liquidation_timestamp = $3, liquidation_reason = $4 WHERE position_id = $5\`,
        [loss, nowMs, nowMs, 'Margin call', pos.positionId]
      );
      await client.query(
        \`INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)\`,
        ['positionUpdated', userId, JSON.stringify(pos), 'pending', currency, nowMs]
      );
    }
    
    // 3. Update Balance
    const balRes = await client.query(
      \`SELECT * FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE\`,
      [userId, currency]
    );
    if (balRes.rows.length > 0) {
      const bal = balRes.rows[0];
      const newBalance = Number(bal.available_balance) + totalRealizedLoss - totalLiquidationFee;
      await client.query(
        \`UPDATE te_balances SET available_balance = $1, locked_balance = 0, total_fees = total_fees + $2, updated_at = $3 WHERE user_id = $4 AND currency = $5\`,
        [newBalance <= 0 ? 0 : newBalance, totalLiquidationFee, nowMs, userId, currency]
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
console.log('liquidateUser replaced again');
