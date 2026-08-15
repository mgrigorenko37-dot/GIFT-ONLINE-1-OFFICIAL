const fs = require('fs');

let content = fs.readFileSync('server/tradingEngine.ts', 'utf8');

// Replace updateMarkPrice
const updateMarkPriceRegex = /public async updateMarkPrice\([\s\S]*?(?=public async liquidateUser)/;
const newUpdateMarkPrice = `public async updateMarkPrice(instrumentKey: string, markPrice: number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const posRes = await client.query(
        "SELECT * FROM te_positions WHERE instrument_key = $1 AND status IN ('Open', 'OPEN', 'MarginCall', 'MARGIN_CALL') FOR UPDATE",
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
        const marginInfo = await this.calculateMargin(client, position.userId, position.collateralCurrency);

        // 5. Определить:
        // достаточно ли маржи;
        // нужен ли MARGIN_CALL;
        // нужна ли liquidation.
        let newStatus = position.status;
        let isLiquidationNeeded = false;

        if (marginInfo.equity <= marginInfo.maintenanceMargin && marginInfo.maintenanceMargin > 0) {
           isLiquidationNeeded = true;
        } else if (marginInfo.equity < marginInfo.usedMargin) {
           newStatus = 'MARGIN_CALL';
        } else {
           newStatus = 'OPEN';
        }

        if (isLiquidationNeeded) {
           // We do liquidation
           await this.liquidateUser(client, position.userId, position.collateralCurrency);
           liquidatedUsers.add(position.userId);
           continue;
        }

        if (newStatus !== position.status) {
           position.status = newStatus as any;
           await client.query(
             'UPDATE te_positions SET status = $1 WHERE position_id = $2',
             [newStatus, position.positionId]
           );
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
          await client.query('ROLLBACK TO SAVEPOINT insert_outbox_mark_sp');
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
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  `;

content = content.replace(updateMarkPriceRegex, newUpdateMarkPrice);
fs.writeFileSync('server/tradingEngine.ts', content);
console.log('updateMarkPrice replaced');
