const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE te_balances RENAME COLUMN balance TO available_balance');
    await client.query(
      "ALTER TABLE te_balances ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'TON'"
    );
    await client.query(
      'ALTER TABLE te_balances ADD COLUMN locked_balance NUMERIC NOT NULL DEFAULT 0'
    );
    await client.query(
      'ALTER TABLE te_balances ADD COLUMN realized_pnl NUMERIC NOT NULL DEFAULT 0'
    );
    await client.query('ALTER TABLE te_balances ADD COLUMN total_fees NUMERIC NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE te_balances ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0');
    await client.query(
      'ALTER TABLE te_balances DROP CONSTRAINT IF EXISTS te_balances_pkey CASCADE'
    );
    await client.query('ALTER TABLE te_balances ADD PRIMARY KEY (user_id, currency)');
    console.log('te_balances altered');
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    process.exit(0);
  }
}

run().catch(console.error);
