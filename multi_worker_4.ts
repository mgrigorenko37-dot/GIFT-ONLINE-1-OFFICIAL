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
const user = process.argv[4];

async function run() {
   console.log(`[Worker ${name}] PID ${process.pid} starting funding...`);
   try {
      const res = await engine.processMissedFundingPeriods({
         lastProcessedTimestamp: ts - 8 * 60 * 60 * 1000,
         currentTimestamp: ts,
         intervalMs: 8 * 60 * 60 * 1000
      });
      let count = 0;
      if (res && res.length > 0) count = res[0].payments.length;
      console.log(`[Worker ${name}] PID ${process.pid} successfully processed ${count} payments.`);
   } catch (e: any) {
      console.log(`[Worker ${name}] PID ${process.pid} failed with error: ${e.message}`);
   }
   process.exit(0);
}
run();
