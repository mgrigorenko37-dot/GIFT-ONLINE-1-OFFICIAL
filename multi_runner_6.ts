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
  const user = 'multi_user_outbox_restart_' + Date.now();

  // Setup DB balance
  await pool.query(
    'INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [user, 'TON', 200, 0, Date.now(), Date.now()]
  );

  // Order 1: TON
  const orderTon = await engine.placeOrder({
    userId: user,
    instrumentKey: 'TON',
    side: 'Buy',
    orderType: 'Limit',
    qty: 10,
    price: 10,
    reduceOnly: false,
  });
  await engine.executeTrade(orderTon!.orderId, 10, 10);

  const ts = Date.now();
  await pool.query('UPDATE te_positions SET opened_at = $1 WHERE user_id = $2', [ts - 10000, user]);

  // Ensure NO pending outbox events before funding
  await pool.query('DELETE FROM te_outbox_events WHERE user_id = $1', [user]);

  await engine.createFundingPeriodSnapshot({
    instrumentKey: 'TON',
    currency: 'TON',
    fundingInterval: '8h',
    fundingTimestamp: ts,
    fundingRate: 0.05,
    markPrice: 10,
  });

  console.log('--- Step 1: Execute Funding (COMMIT) ---');
  // Execution happens here, pushing into Outbox DB
  const payments = await engine.processMissedFundingPeriods({
    lastProcessedTimestamp: ts - 8 * 60 * 60 * 1000,
    currentTimestamp: ts,
    intervalMs: 8 * 60 * 60 * 1000,
  });
  console.log(
    `Funding executed, payments count: ${payments && payments.length > 0 ? payments[0].payments.length : 0}`
  );

  const outboxCheck = await pool.query(
    'SELECT status, id, event_type FROM te_outbox_events WHERE user_id = $1',
    [user]
  );
  console.log(`Outbox DB rows after funding (pending): ${outboxCheck.rowCount}`);
  for (let row of outboxCheck.rows) {
    console.log(` - ID: ${row.id}, Type: ${row.event_type}, Status: ${row.status}`);
  }

  const runOutboxWorker = (shouldCrash: boolean) => {
    return new Promise((resolve) => {
      const env = Object.assign({}, process.env, shouldCrash ? { CRASH_BEFORE_EMIT: '1' } : {});
      const proc = spawn('npx', ['tsx', 'multi_worker_6.ts'], { env });
      proc.stdout.on('data', (d) => process.stdout.write(d));
      proc.stderr.on('data', (d) => process.stderr.write(d));
      proc.on('close', (code) => resolve(code));
    });
  };

  console.log('\n--- Step 2: Outbox Worker A (CRASHING before emit) ---');
  await runOutboxWorker(true);

  let outboxStatus = await pool.query(
    'SELECT status, id, event_type FROM te_outbox_events WHERE user_id = $1',
    [user]
  );
  for (let row of outboxStatus.rows) {
    console.log(` - ID: ${row.id}, Type: ${row.event_type}, Status: ${row.status}`);
  }
  let bal = await pool.query(
    'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2',
    [user, 'TON']
  );
  console.log(`Balance TON: ${bal.rows[0].available_balance} (Should still be 194.75)`);

  console.log('\n--- Step 3: Outbox Worker B (NORMAL RECOVERY) ---');
  await runOutboxWorker(false);

  outboxStatus = await pool.query(
    'SELECT status, id, event_type FROM te_outbox_events WHERE user_id = $1',
    [user]
  );
  for (let row of outboxStatus.rows) {
    console.log(` - ID: ${row.id}, Type: ${row.event_type}, Status: ${row.status}`);
  }

  process.exit(0);
}
main();
