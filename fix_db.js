const { Pool } = require('pg');
const pool = new Pool({ 
  host: process.env.SQL_HOST,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  database: process.env.SQL_DB_NAME
});
async function run() {
  await pool.query('ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_timestamp BIGINT');
  await pool.query('ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_reason TEXT');
  console.log('done');
  process.exit(0);
}
run();
