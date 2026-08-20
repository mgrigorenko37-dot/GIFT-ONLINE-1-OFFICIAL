const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
  await pool
    .query(
      'ALTER TABLE te_executions DROP CONSTRAINT IF EXISTS te_executions_user_id_instrument_key_key'
    )
    .catch((e) => {});

  // te_executions
  const execCols = [
    'requested_qty NUMERIC DEFAULT 0',
    'fill_qty NUMERIC DEFAULT 0',
    'fill_price NUMERIC DEFAULT 0',
    "settlement_currency VARCHAR(32) DEFAULT 'TON'",
    "fee_currency VARCHAR(32) DEFAULT 'TON'",
    "pnl_currency VARCHAR(32) DEFAULT 'TON'",
    'processed_at BIGINT DEFAULT 0',
    'source VARCHAR(255)',
    'external_execution_id VARCHAR(255)',
  ];
  for (const c of execCols) {
    await pool
      .query(
        `ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS ${c.split(' ')[0]} ${c.split(' ').slice(1).join(' ')}`
      )
      .catch((e) => {});
  }

  process.exit(0);
})();
