const fs = require('fs');

let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

const start = code.indexOf('public async executeTrade(');
const end = code.indexOf('public async updateMarkPrice(');

const newMethod = `public async executeTrade(orderId: string, fillQty: number, fillPrice: number, executionId?: string, options?: { source?: string, externalExecutionId?: string }): Promise<Trade | null> {
    const client = await this.pool.connect();
    const actualExecutionId = executionId || crypto.randomUUID();
    
    try {
      await client.query('BEGIN');
      
      const execCheck = await client.query('SELECT * FROM te_executions WHERE execution_id = $1 FOR UPDATE', [actualExecutionId]);
      if (execCheck.rows.length > 0) {
        const existingExec = execCheck.rows[0];
        if (Number(existingExec.fill_qty) === fillQty && Number(existingExec.fill_price) === fillPrice && existingExec.order_id === orderId) {
          await client.query('ROLLBACK');
          return null; // Already processed
        } else {
          await client.query('ROLLBACK');
          throw new Error('Conflict: execution_id already exists with different data');
        }
      }

      if (options?.source && options?.externalExecutionId) {
        const extCheck = await client.query('SELECT * FROM te_executions WHERE source = $1 AND external_execution_id = $2 FOR UPDATE', [options.source, options.externalExecutionId]);
        if (extCheck.rows.length > 0) {
           await client.query('ROLLBACK');
           return null;
        }
      }

      const orderRes = await client.query('SELECT * FROM te_orders WHERE order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const order = this.mapOrder(orderRes.rows[0]);
      
      if (order.status !== 'Open' && order.status !== 'PartiallyFilled') {
        await client.query('ROLLBACK');
        return null;
      }
      
      const posRes = await client.query('SELECT * FROM te_positions WHERE user_id = $1 AND instrument_key = $2 FOR UPDATE', [order.userId, order.instrumentKey]);
      let oldPosition = posRes.rows.length > 0 ? this.mapPosition(posRes.rows[0]) : null;
      const hasPosition = oldPosition && oldPosition.status === 'Open';

      let executionStatus = 'PROCESSING';
      let rejectedReason = '';

      if (order.positionEffect === 'Close') {
        if (!hasPosition) {
          order.status = 'Rejected';
          order.rejectionReason = 'Position closed before execution';
          order.updatedAt = Date.now();
          await client.query(\`UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4\`, [order.status, order.rejectionReason, order.updatedAt, order.orderId]);
          await client.query('INSERT INTO te_outbox_events (event_type, user_id, payload, created_at) VALUES ($1, $2, $3, $4)', [
            'orderUpdated', order.userId, JSON.stringify(order), order.updatedAt
          ]);
          await client.query(\`INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)\`, 
            [actualExecutionId, orderId, order.userId, order.instrumentKey, order.side, fillQty, 0, 0, 0, 'REJECTED', Date.now(), Date.now(), options?.source || null, options?.externalExecutionId || null]);
          await client.query('COMMIT');
          return null;
        }
        
        const isOpposite = (oldPosition.side === 'Long' && order.side === 'Sell') || (oldPosition.side === 'Short' && order.side === 'Buy');
        if (!isOpposite) {
          order.status = 'Rejected';
          order.rejectionReason = 'Position side changed';
          order.updatedAt = Date.now();
          await client.query(\`UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4\`, [order.status, order.rejectionReason, order.updatedAt, order.orderId]);
          await client.query(\`INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)\`, 
            [actualExecutionId, orderId, order.userId, order.instrumentKey, order.side, fillQty, 0, 0, 0, 'REJECTED', Date.now(), Date.now(), options?.source || null, options?.externalExecutionId || null]);
          await client.query('COMMIT');
          return null;
        }

        if (fillQty > oldPosition.qty) {
          fillQty = oldPosition.qty;
        }
      } else if (order.positionEffect === 'Open') {
        if (hasPosition) {
          const isOpposite = (oldPosition.side === 'Long' && order.side === 'Sell') || (oldPosition.side === 'Short' && order.side === 'Buy');
          if (isOpposite) {
            order.status = 'Rejected';
            order.rejectionReason = 'Cannot open opposite position while current position exists';
            order.updatedAt = Date.now();
            await client.query(\`UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4\`, [order.status, order.rejectionReason, order.updatedAt, order.orderId]);
            await client.query(\`INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)\`, 
            [actualExecutionId, orderId, order.userId, order.instrumentKey, order.side, fillQty, 0, 0, 0, 'REJECTED', Date.now(), Date.now(), options?.source || null, options?.externalExecutionId || null]);
            await client.query('COMMIT');
            return null;
          }
        }
      }

      const requestedQty = fillQty;
      if (fillQty <= 0) {
        await client.query('ROLLBACK');
        return null;
      }
      if (fillQty > order.remainingQty) {
        fillQty = order.remainingQty;
      }
      if (fillQty === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      
      const totalCost = (order.avgFillPrice * order.executedQty) + (fillPrice * fillQty);
      const fee = fillQty * fillPrice * 0.0025;
      
      order.executedQty += fillQty;
      order.fee += fee;
      order.remainingQty -= fillQty;
      order.avgFillPrice = totalCost / order.executedQty;
      order.updatedAt = Date.now();
      
      if (order.remainingQty === 0) {
        order.status = 'Filled';
      } else {
        if (order.positionEffect === 'Close' && oldPosition && (oldPosition.qty - fillQty) <= 0) {
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
        fee: fee
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
          openedAt: Date.now(),
          updatedAt: Date.now()
        };
      } else {
        newPosition = { ...oldPosition };
        const isIncrease = (newPosition.side === 'Long' && isBuy) || (newPosition.side === 'Short' && !isBuy);
        if (isIncrease) {
          const totalValue = (newPosition.qty * newPosition.avgEntryPrice) + (fillQty * fillPrice);
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
      
      const oldPnl = oldPosition ? oldPosition.realizedPnl : 0;
      const newPnl = newPosition.realizedPnl;
      
      const currentTradeRealizedPnl = order.positionEffect === 'Close' ? newPnl - oldPnl : 0;
      trade.realizedPnl = currentTradeRealizedPnl;

      const balRes = await client.query('SELECT balance FROM te_balances WHERE user_id = $1 FOR UPDATE', [order.userId]);
      let currentBalance = balRes.rows.length > 0 ? Number(balRes.rows[0].balance) : 12480.5;
      
      const newBalance = currentBalance - fee + currentTradeRealizedPnl;
      
      await client.query(
        \`UPDATE te_orders SET status=$1, executed_qty=$2, remaining_qty=$3, avg_fill_price=$4, fee=$5, updated_at=$6, rejection_reason=$7 WHERE order_id=$8\`,
        [order.status, order.executedQty, order.remainingQty, order.avgFillPrice, order.fee, order.updatedAt, order.rejectionReason || null, order.orderId]
      );
      
      await client.query(
        \`INSERT INTO te_trades (trade_id, order_id, user_id, instrument_key, side, qty, price, fee, realized_pnl, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)\`,
        [trade.tradeId, trade.orderId, trade.userId, trade.instrumentKey, trade.side, trade.qty, trade.price, trade.fee, trade.realizedPnl, trade.timestamp]
      );
      
      if (!oldPosition) {
        const res = await client.query(
          \`INSERT INTO te_positions (position_id, user_id, instrument_key, side, qty, avg_entry_price, mark_price, unrealized_pnl, realized_pnl, status, opened_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)\`,
          [newPosition.positionId, newPosition.userId, newPosition.instrumentKey, newPosition.side, newPosition.qty, newPosition.avgEntryPrice, newPosition.markPrice, newPosition.unrealizedPnl, newPosition.realizedPnl, newPosition.status, newPosition.openedAt, newPosition.updatedAt]
        );
        if (res.rowCount === 0) throw new Error('Failed to insert position');
      } else {
        const res = await client.query(
          \`UPDATE te_positions SET side=$1, qty=$2, avg_entry_price=$3, mark_price=$4, unrealized_pnl=$5, realized_pnl=$6, status=$7, opened_at=$8, updated_at=$9 WHERE position_id=$10\`,
          [newPosition.side, newPosition.qty, newPosition.avgEntryPrice, newPosition.markPrice, newPosition.unrealizedPnl, newPosition.realizedPnl, newPosition.status, newPosition.openedAt, newPosition.updatedAt, newPosition.positionId]
        );
        if (res.rowCount === 0) throw new Error('Failed to update position');
      }
      
      if (balRes.rows.length === 0) {
        await client.query(\`INSERT INTO te_balances (user_id, balance, updated_at) VALUES ($1, $2, $3)\`, [order.userId, newBalance, Date.now()]);
      } else {
        await client.query(\`UPDATE te_balances SET balance=$1, updated_at=$2 WHERE user_id=$3\`, [newBalance, Date.now(), order.userId]);
      }
      
      const now = Date.now();
      await client.query(
        \`INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)\`, 
        [actualExecutionId, orderId, order.userId, order.instrumentKey, order.side, requestedQty, fillQty, fillPrice, fee, 'COMPLETED', now, now, options?.source || null, options?.externalExecutionId || null]
      );

      const events = [
        { type: 'tradeExecuted', payload: trade },
        { type: 'orderUpdated', payload: order },
        { type: 'positionUpdated', payload: newPosition },
        { type: 'balanceUpdated', payload: { userId: order.userId, balance: newBalance } },
        { type: 'historyUpdated', payload: { userId: order.userId, trade } }
      ];
      
      for (const ev of events) {
        await client.query('INSERT INTO te_outbox_events (event_type, user_id, payload, created_at) VALUES ($1, $2, $3, $4)', [
          ev.type, order.userId, JSON.stringify(ev.payload), now
        ]);
      }
      
      await client.query('COMMIT');
      return trade;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  `;

code = code.substring(0, start) + newMethod + code.substring(end);
fs.writeFileSync('server/tradingEngine.ts', code);
