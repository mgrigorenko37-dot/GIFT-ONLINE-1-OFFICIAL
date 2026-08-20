const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
  await pool.query('ALTER TABLE te_position_snapshots ADD COLUMN settlement_currency VARCHAR(32) DEFAULT \'TON\'').catch(e => console.error(e));
  await pool.query('ALTER TABLE te_position_snapshots ADD COLUMN collateral_currency VARCHAR(32) DEFAULT \'TON\'').catch(e => console.error(e));
  process.exit(0);
})();
