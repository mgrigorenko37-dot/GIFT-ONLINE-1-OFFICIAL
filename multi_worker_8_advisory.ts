import { Pool } from 'pg';
import { SchedulerLease } from './server/schedulerLease';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

const name = process.argv[2];
const ts = process.argv[3];
const delayMs = parseInt(process.argv[4]);

async function run() {
  const lease = new SchedulerLease(pool, name);
  console.log(`[Worker ${name}] Trying to acquire lock for timestamp ${ts}...`);

  const lockClient = await lease.tryAcquireLock('FUNDING_JOB', ts);

  if (!lockClient) {
    console.log(`[Worker ${name}] Lock is HELD by another instance. Skipping.`);
    process.exit(0);
  }

  console.log(
    `[Worker ${name}] ACQUIRED Lock! Executing funding task (simulated for ${delayMs}ms)...`
  );
  await new Promise((r) => setTimeout(r, delayMs));

  console.log(`[Worker ${name}] Task complete. Releasing lock.`);
  await lease.releaseLock(lockClient, 'FUNDING_JOB', ts);

  process.exit(0);
}
run();
