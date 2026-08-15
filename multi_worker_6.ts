import { Pool } from 'pg';
import { processTradingOutbox } from './server/tradingOutboxWorker';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

// A dummy socket.io stand-in
const dummyIo = {
  to: (userId: string) => ({
     emit: (eventType: string, payload: any) => {
        console.log(`[Socket.IO Mock] EMITTED ${eventType} to user ${userId}`);
     }
  })
};

async function run() {
   console.log(`[Outbox Worker] PID ${process.pid} processing events...`);
   try {
      await processTradingOutbox(pool, dummyIo as any);
      console.log(`[Outbox Worker] PID ${process.pid} finished processing.`);
   } catch (e: any) {
      console.log(`[Outbox Worker] PID ${process.pid} failed with error: ${e.message}`);
   }
   process.exit(0);
}
run();
