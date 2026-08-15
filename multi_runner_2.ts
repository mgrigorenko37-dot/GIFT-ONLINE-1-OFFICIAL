import { spawn } from 'child_process';
import { Pool } from 'pg';
import { PostgresTradingEngine } from './server/tradingEngine';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

async function main() {
   const engine = new PostgresTradingEngine(pool);
   const user = 'multi_user_concurrent_' + Date.now();
   
   // Setup DB balances
   await pool.query('INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [user, 'TON', 200, 0, Date.now(), Date.now()]);
   await pool.query('INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [user, 'STARS', 500, 0, Date.now(), Date.now()]);

   // Order 1: TON
   const orderTon = await engine.placeOrder({ userId: user, instrumentKey: 'TON', side: 'Buy', orderType: 'Limit', qty: 10, price: 10, reduceOnly: false });
   await engine.executeTrade(orderTon!.orderId, 10, 10);
   // Order 2: STARS
   const orderStars = await engine.placeOrder({ userId: user, instrumentKey: 'STARS', side: 'Sell', orderType: 'Limit', qty: 20, price: 5, reduceOnly: false });
   await engine.executeTrade(orderStars!.orderId, 20, 5);
   
   // Ensure `opened_at` is back in time
   const ts = Date.now();
   await pool.query('UPDATE te_positions SET opened_at = $1 WHERE user_id = $2', [ts - 10000, user]);
   
   const posRes = await pool.query('SELECT position_id, instrument_key, realized_pnl, qty, side, avg_entry_price FROM te_positions WHERE user_id = $1', [user]);
   let tonPos, starsPos;
   for (const p of posRes.rows) {
      if (p.instrument_key === 'TON') tonPos = p;
      if (p.instrument_key === 'STARS') starsPos = p;
   }

   // Create snapshots
   await engine.createFundingPeriodSnapshot({ instrumentKey: 'TON', currency: 'TON', fundingInterval: '8h', fundingTimestamp: ts, fundingRate: 0.05, markPrice: 10 });
   await engine.createFundingPeriodSnapshot({ instrumentKey: 'STARS', currency: 'STARS', fundingInterval: '8h', fundingTimestamp: ts, fundingRate: 0.05, markPrice: 5 });

   await pool.query('DELETE FROM te_funding_payments WHERE funding_timestamp = $1 AND user_id = $2', [ts, user]);

   // Helper
   const runWorker = (name: string) => {
      return new Promise((resolve) => {
         const proc = spawn('npx', ['tsx', 'multi_worker_2.ts', name, String(ts), user], { env: process.env });
         proc.stdout.on('data', d => process.stdout.write(d));
         proc.stderr.on('data', d => process.stderr.write(d));
         proc.on('close', code => resolve(code));
      });
   };

   console.log('Spawning Worker A and Worker B concurrently...');
   await Promise.all([runWorker('A'), runWorker('B')]);

   console.log(`\n--- DB VERIFICATION ---`);
   
   // 1. Funding Payments counts
   const payTon = await pool.query('SELECT COUNT(*) as c FROM te_funding_payments WHERE position_id = $1 AND funding_timestamp = $2', [tonPos.position_id, ts]);
   const payStars = await pool.query('SELECT COUNT(*) as c FROM te_funding_payments WHERE position_id = $1 AND funding_timestamp = $2', [starsPos.position_id, ts]);
   console.log(`Funding Payments TON count: ${payTon.rows[0].c} (expected 1)`);
   console.log(`Funding Payments STARS count: ${payStars.rows[0].c} (expected 1)`);

   // 2. Balances
   const balTon = await pool.query('SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2', [user, 'TON']);
   const balStars = await pool.query('SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2', [user, 'STARS']);
   // TON initially 200 - fee 0.25 = 199.75. Funding pays 10 * 10 * 0.05 = 5.0. New Bal = 194.75.
   // STARS initially 500 - fee 0.25 = 499.75. Funding (short receives positive rate) receives 20 * 5 * 0.05 = 5.0. New Bal = 504.75.
   console.log(`Final balance TON: ${balTon.rows[0].available_balance} (expected 194.75)`);
   console.log(`Final balance STARS: ${balStars.rows[0].available_balance} (expected 504.75)`);

   // 3. Outbox and Ledger
   const outboxTon = await pool.query(`SELECT COUNT(*) as c FROM te_outbox_events WHERE user_id = $1 AND event_type = 'ledgerUpdated' AND payload LIKE '%"currency":"TON"%' AND payload LIKE '%FUNDING%'`, [user]);
   const outboxStars = await pool.query(`SELECT COUNT(*) as c FROM te_outbox_events WHERE user_id = $1 AND event_type = 'ledgerUpdated' AND payload LIKE '%"currency":"STARS"%' AND payload LIKE '%FUNDING%'`, [user]);
   console.log(`Outbox FUNDING events TON: ${outboxTon.rows[0].c} (expected 1)`);
   console.log(`Outbox FUNDING events STARS: ${outboxStars.rows[0].c} (expected 1)`);

   // 4. Invariants
   const posResAfter = await pool.query('SELECT position_id, instrument_key, realized_pnl, qty, side, avg_entry_price FROM te_positions WHERE user_id = $1', [user]);
   for (const p of posResAfter.rows) {
      if (p.instrument_key === 'TON') {
         console.log(`TON Position: qty=${p.qty} side=${p.side} avgEntry=${p.avg_entry_price} realizedPnl=${p.realized_pnl}`);
         console.log(`  (Matches initial: qty=${tonPos.qty} side=${tonPos.side} avgEntry=${tonPos.avg_entry_price} realizedPnl=${tonPos.realized_pnl})`);
      }
      if (p.instrument_key === 'STARS') {
         console.log(`STARS Position: qty=${p.qty} side=${p.side} avgEntry=${p.avg_entry_price} realizedPnl=${p.realized_pnl}`);
         console.log(`  (Matches initial: qty=${starsPos.qty} side=${starsPos.side} avgEntry=${starsPos.avg_entry_price} realizedPnl=${starsPos.realized_pnl})`);
      }
   }

   process.exit(0);
}
main();
