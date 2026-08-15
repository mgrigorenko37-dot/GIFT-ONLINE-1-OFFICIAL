import { spawn } from 'child_process';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

async function main() {
   const user = 'outbox_test_' + Date.now();
   
   // Insert 20 test events
   for (let i = 0; i < 20; i++) {
       await pool.query(
           `INSERT INTO te_outbox_events (user_id, event_type, payload, status, created_at) 
            VALUES ($1, $2, $3, 'test_pending', $4)`,
           [user, 'testEvent', JSON.stringify({ i }), Date.now()]
       );
   }

   const runWorker = (name: string, shouldCrashOnI?: number) => {
      return new Promise((resolve) => {
         const env = Object.assign({}, process.env, shouldCrashOnI !== undefined ? { CRASH_ON_I: String(shouldCrashOnI) } : {});
         const proc = spawn('npx', ['tsx', 'multi_worker_outbox.ts', name, user], { env });
         proc.stdout.on('data', d => process.stdout.write(d));
         proc.stderr.on('data', d => process.stderr.write(d));
         proc.on('close', code => resolve(code));
      });
   };

   console.log('Spawning Outbox Worker A and Worker B concurrently...');
   await Promise.all([runWorker('A'), runWorker('B')]);

   const pending = await pool.query(`SELECT COUNT(*) as c FROM te_outbox_events WHERE user_id = $1 AND status = 'test_pending'`, [user]);
   const published = await pool.query(`SELECT COUNT(*) as c FROM te_outbox_events WHERE user_id = $1 AND status = 'test_published'`, [user]);
   console.log(`\n--- DB VERIFICATION ---`);
   console.log(`Pending events: ${pending.rows[0].c} (expected 0)`);
   console.log(`Published events: ${published.rows[0].c} (expected 20)`);

   // Now test error handling (delivery failure / crash)
   console.log('\n--- Inserting 5 new events for crash test ---');
   for (let i = 100; i < 105; i++) {
       await pool.query(
           `INSERT INTO te_outbox_events (user_id, event_type, payload, status, created_at) 
            VALUES ($1, $2, $3, 'test_pending', $4)`,
           [user, 'testEvent', JSON.stringify({ i }), Date.now()]
       );
   }
   
   console.log('Spawning Outbox Worker C that crashes on i=102');
   await runWorker('C', 102);

   const pendingCrash = await pool.query(`SELECT COUNT(*) as c FROM te_outbox_events WHERE user_id = $1 AND status = 'test_pending'`, [user]);
   console.log(`Pending events after crash: ${pendingCrash.rows[0].c} (expected 5, because transaction rollbacks)`);

   console.log('Spawning Outbox Worker D to recover');
   await runWorker('D');

   const pendingRecover = await pool.query(`SELECT COUNT(*) as c FROM te_outbox_events WHERE user_id = $1 AND status = 'test_pending'`, [user]);
   const publishedRecover = await pool.query(`SELECT COUNT(*) as c FROM te_outbox_events WHERE user_id = $1 AND status = 'test_published'`, [user]);
   
   console.log(`Pending events after recovery: ${pendingRecover.rows[0].c} (expected 0)`);
   console.log(`Total Published events: ${publishedRecover.rows[0].c} (expected 25)`);

   process.exit(0);
}
main();
