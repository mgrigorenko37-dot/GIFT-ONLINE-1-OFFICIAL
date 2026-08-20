import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

const name = process.argv[2];
const userFilter = process.argv[3];
const crashOnI = process.env.CRASH_ON_I ? parseInt(process.env.CRASH_ON_I) : -1;

async function run() {
  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query('BEGIN');

    // We add a LIMIT 10 so they don't both grab all 20 at once in the test
    const res = await client.query(
      `
      SELECT * FROM te_outbox_events 
      WHERE status = 'test_pending' AND user_id = $1
      ORDER BY id ASC 
      LIMIT 10 
      FOR UPDATE SKIP LOCKED
    `,
      [userFilter]
    );

    for (const row of res.rows) {
      const data = JSON.parse(row.payload);

      // simulated delivery
      if (crashOnI === data.i) {
        console.log(
          `[Worker ${name}] CRASHING on simulated delivery failure for i=${data.i} (ID: ${row.id})`
        );
        throw new Error('Delivery failure simulated');
      }

      console.log(`[Worker ${name}] Delivered event i=${data.i} (ID: ${row.id})`);

      await client.query(
        `UPDATE te_outbox_events SET status = 'test_published', published_at = $1 WHERE id = $2`,
        [Date.now(), row.id]
      );
      processed++;
      // slight delay to ensure concurrent worker takes other rows
      await new Promise((r) => setTimeout(r, 20));
    }
    await client.query('COMMIT');
    console.log(`[Worker ${name}] Successfully committed ${processed} events.`);
  } catch (err: any) {
    console.log(`[Worker ${name}] Error: ${err.message}. Rolling back.`);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
