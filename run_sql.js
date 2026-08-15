const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});
async function run() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS te_executions (
      execution_id VARCHAR(255) PRIMARY KEY,
      order_id VARCHAR(255) NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      instrument_key VARCHAR(255) NOT NULL,
      side VARCHAR(10) NOT NULL,
      requested_qty NUMERIC NOT NULL,
      fill_qty NUMERIC NOT NULL,
      fill_price NUMERIC NOT NULL,
      fee NUMERIC NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at BIGINT NOT NULL,
      processed_at BIGINT NOT NULL,
      source VARCHAR(50),
      external_execution_id VARCHAR(255)
    )`);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS te_executions_source_ext_idx ON te_executions(source, external_execution_id) WHERE source IS NOT NULL AND external_execution_id IS NOT NULL`
    );
    console.log('Success');
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit();
}
run();
