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
   const user = 'multi_user_' + Date.now();
   
   // setup DB
   await pool.query('INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [user, 'TON', 200, 0, Date.now(), Date.now()]);
   const order = await engine.placeOrder({ userId: user, instrumentKey: 'TON', side: 'Buy', orderType: 'Limit', qty: 10, price: 10, reduceOnly: false });
   await engine.executeTrade(order!.orderId, 10, 10);
   
   // Move `opened_at` back in time so it's eligible
   const ts = Date.now();
   await pool.query('UPDATE te_positions SET opened_at = $1 WHERE user_id = $2', [ts - 10000, user]);
   
   // Create snapshot at exactly `ts`
   await engine.createFundingPeriodSnapshot({
      instrumentKey: 'TON',
      currency: 'TON',
      fundingInterval: '8h',
      fundingTimestamp: ts,
      fundingRate: 0.05,
      markPrice: 10
   });

   // clear outbox and old payments for test purity
   await pool.query('DELETE FROM te_funding_payments WHERE funding_timestamp = $1', [ts]);

   const runWorker = (name: string) => {
      return new Promise((resolve) => {
         const proc = spawn('npx', ['tsx', 'multi_worker.ts', name, String(ts)], { env: process.env });
         proc.stdout.on('data', d => process.stdout.write(d));
         proc.stderr.on('data', d => process.stderr.write(d));
         proc.on('close', code => resolve(code));
      });
   };

   console.log('Spawning Worker A and Worker B concurrently in separate processes...');
   await Promise.all([runWorker('A'), runWorker('B')]);

   // Verify DB
   const payments = await pool.query('SELECT * FROM te_funding_payments WHERE funding_timestamp = $1 AND user_id = $2', [ts, user]);
   console.log(`\n--- DB VERIFICATION ---`);
   console.log(`Total payments in DB for this user/timestamp: ${payments.rows.length}`);
   if (payments.rows.length > 0) {
      console.log(`Payment status: ${payments.rows[0].status}`);
      console.log(`Payment error_reason: ${payments.rows[0].error_reason}`);
   }
   
   const bal = await pool.query('SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2', [user, 'TON']);
   console.log(`Final balance for user (Initial 200 - fee 0.25 - funding 5.00 = 194.75): ${bal.rows[0].available_balance}`);

   process.exit(0);
}
main();
