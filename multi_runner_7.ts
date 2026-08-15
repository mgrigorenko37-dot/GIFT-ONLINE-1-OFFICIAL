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
   const user = 'multi_user_catchup_' + Date.now();
   
   // Setup DB balances
   await pool.query('INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [user, 'TON', 1000, 0, Date.now(), Date.now()]);
   await pool.query('INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [user, 'STARS', 1000, 0, Date.now(), Date.now()]);

   const intervalMs = 10000;
   const t4 = Math.floor(Date.now() / intervalMs) * intervalMs;
   const t3 = t4 - intervalMs;
   const t2 = t3 - intervalMs;
   const t1 = t2 - intervalMs;
   const t0 = t1 - intervalMs;

   // Order 1: TON
   const orderTon = await engine.placeOrder({ userId: user, instrumentKey: 'TON', side: 'Buy', orderType: 'Limit', qty: 10, price: 10, reduceOnly: false });
   await engine.executeTrade(orderTon!.orderId, 10, 10);
   // Order 2: STARS
   const orderStars = await engine.placeOrder({ userId: user, instrumentKey: 'STARS', side: 'Buy', orderType: 'Limit', qty: 20, price: 5, reduceOnly: false });
   await engine.executeTrade(orderStars!.orderId, 20, 5);
   
   // Backdate positions
   await pool.query('UPDATE te_positions SET opened_at = $1 WHERE user_id = $2', [t0, user]);
   
   const posRes = await pool.query('SELECT position_id, instrument_key FROM te_positions WHERE user_id = $1', [user]);
   let tonPos, starsPos;
   for (const p of posRes.rows) {
      if (p.instrument_key === 'TON') tonPos = p;
      if (p.instrument_key === 'STARS') starsPos = p;
   }
   
   // Backdate position snapshots so they cover t1..t4
   await pool.query('UPDATE te_position_snapshots SET valid_from = $1 WHERE position_id = $2', [t0, tonPos.position_id]);
   await pool.query('UPDATE te_position_snapshots SET valid_from = $1 WHERE position_id = $2', [t0, starsPos.position_id]);

   // Snapshots
   for (const ts of [t1, t2, t3, t4]) {
      await engine.createFundingPeriodSnapshot({ instrumentKey: 'TON', currency: 'TON', fundingInterval: '8h', fundingTimestamp: ts, fundingRate: 0.01, markPrice: 10 });
      await engine.createFundingPeriodSnapshot({ instrumentKey: 'STARS', currency: 'STARS', fundingInterval: '8h', fundingTimestamp: ts, fundingRate: 0.02, markPrice: 5 });
   }

   // Set cursors via existing payments
   await pool.query('DELETE FROM te_funding_payments WHERE user_id = $1', [user]);
   
   // TON processed at t1
   await pool.query(
      `INSERT INTO te_funding_payments 
      (funding_id, position_id, user_id, instrument_key, currency, side, funding_rate, funding_interval, funding_timestamp, mark_price, qty, notional, funding_amount, status, created_at, processed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      ['fp_ton_' + t1, tonPos.position_id, user, 'TON', 'TON', 'Long', 0.01, '8h', t1, 10, 10, 100, 1.0, 'PROCESSED', Date.now(), Date.now()]
   );

   // STARS processed at t1, t2, t3
   for (const ts of [t1, t2, t3]) {
      await pool.query(
         `INSERT INTO te_funding_payments 
         (funding_id, position_id, user_id, instrument_key, currency, side, funding_rate, funding_interval, funding_timestamp, mark_price, qty, notional, funding_amount, status, created_at, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
         ['fp_stars_' + ts, starsPos.position_id, user, 'STARS', 'STARS', 'Long', 0.02, '8h', ts, 5, 20, 100, 2.0, 'PROCESSED', Date.now(), Date.now()]
      );
   }

   // Helper
   const runWorker = (name: string) => {
      return new Promise((resolve) => {
         const proc = spawn('npx', ['tsx', 'multi_worker_7.ts', name, String(t4), String(intervalMs)], { env: process.env });
         proc.stdout.on('data', d => process.stdout.write(d));
         proc.stderr.on('data', d => process.stderr.write(d));
         proc.on('close', code => resolve(code));
      });
   };

   console.log('Spawning Worker A and Worker B concurrently for Catch-Up...');
   await Promise.all([runWorker('A'), runWorker('B')]);

   console.log(`\n--- DB VERIFICATION ---`);
   
   // Verify TON
   const payTon = await pool.query('SELECT funding_timestamp FROM te_funding_payments WHERE position_id = $1 ORDER BY funding_timestamp ASC', [tonPos.position_id]);
   console.log(`TON Payments: ${payTon.rows.map(r => r.funding_timestamp === String(t1) ? 't1' : r.funding_timestamp === String(t2) ? 't2' : r.funding_timestamp === String(t3) ? 't3' : r.funding_timestamp === String(t4) ? 't4' : r.funding_timestamp).join(', ')}`);
   
   // Verify STARS
   const payStars = await pool.query('SELECT funding_timestamp FROM te_funding_payments WHERE position_id = $1 ORDER BY funding_timestamp ASC', [starsPos.position_id]);
   console.log(`STARS Payments: ${payStars.rows.map(r => r.funding_timestamp === String(t1) ? 't1' : r.funding_timestamp === String(t2) ? 't2' : r.funding_timestamp === String(t3) ? 't3' : r.funding_timestamp === String(t4) ? 't4' : r.funding_timestamp).join(', ')}`);
   
   const tonBal = await pool.query('SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2', [user, 'TON']);
   console.log(`TON Balance: ${tonBal.rows[0].available_balance} (Expected 996.75)`);
   
   const starsBal = await pool.query('SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2', [user, 'STARS']);
   console.log(`STARS Balance: ${starsBal.rows[0].available_balance} (Expected 997.75)`);

   process.exit(0);
}
main();
