import { Pool } from 'pg';
import { PostgresTradingEngine } from './server/tradingEngine';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

const engine = new PostgresTradingEngine(pool);
const name = process.argv[2];
const ts = parseInt(process.argv[3]);
const instrumentKey = process.argv[4];
const currency = process.argv[5];

async function run() {
  console.log(`[Worker ${name} - ${currency}] PID ${process.pid} starting funding...`);
  try {
    const res = await engine.processMissedFundingPeriods({
      lastProcessedTimestamp: ts - 8 * 60 * 60 * 1000,
      currentTimestamp: ts,
      intervalMs: 8 * 60 * 60 * 1000,
      instrumentKey: instrumentKey,
      currency: currency,
    });
    console.log(`[Worker ${name} - ${currency}] PID ${process.pid} processing done.`);
  } catch (e: any) {
    console.log(
      `[Worker ${name} - ${currency}] PID ${process.pid} failed with error: ${e.message}`
    );
  }
  process.exit(0);
}
run();
