const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.SQL_ADMIN_HOST || process.env.SQL_HOST,
  user: process.env.SQL_ADMIN_USER || process.env.SQL_USER,
  password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

async function run() {
  await pool.query('DROP TABLE IF EXISTS te_balances CASCADE');
  await pool.query(`CREATE TABLE IF NOT EXISTS te_balances (
    user_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    available_balance NUMERIC NOT NULL DEFAULT 0,
    locked_balance NUMERIC NOT NULL DEFAULT 0,
    realized_pnl NUMERIC NOT NULL DEFAULT 0,
    total_fees NUMERIC NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, currency)
  )`);
  console.log('te_balances recreated');
  process.exit(0);
}

run().catch(console.error);
