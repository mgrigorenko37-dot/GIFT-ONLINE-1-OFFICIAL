import { PostgresTradingEngine } from './server/tradingEngine.js';

async function test() {
  const client = {
    query: async (q, values) => {
      console.log('QUERY:', q);
      if (q === 'BEGIN') return;
      if (q === 'COMMIT') return;
      if (q === 'ROLLBACK') return;
      if (q.includes('FROM te_orders')) {
        return {
          rows: [
            {
              order_id: 'ord1',
              remaining_qty: 10,
              status: 'Open',
              executed_qty: 0,
              avg_fill_price: 0,
              instrument_key: 'durov-cap:all:all:TON',
              user_id: 'user1',
              side: 'Buy',
              position_effect: 'Open',
              price: 100,
            },
          ],
        };
      }
      if (q.includes('SELECT * FROM te_positions')) {
        return { rows: [] };
      }
      if (q.includes('SELECT available_balance, locked_balance')) {
        return {
          rows: [
            {
              available_balance: 2000,
              locked_balance: 0,
              realized_pnl: 0,
              total_fees: 0,
            },
          ],
        };
      }
      if (q.includes('SELECT * FROM te_balances')) {
        return {
          rows: [
            {
              available_balance: 2000,
              locked_balance: 0,
              realized_pnl: 0,
              total_fees: 0,
            },
          ],
        };
      }
      if (q.includes('INSERT INTO te_outbox_events')) {
        return;
      }
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = {
    connect: async () => client,
  };
  const engine = new PostgresTradingEngine(pool);
  const trade = await engine.executeTrade('ord1', 5, 100);
  console.log('TRADE:', trade);
}
test().catch(console.error);
