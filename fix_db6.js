const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
  await pool.query('ALTER TABLE te_executions ALTER COLUMN qty DROP NOT NULL').catch(e => {});
  await pool.query('ALTER TABLE te_executions ALTER COLUMN price DROP NOT NULL').catch(e => {});
  process.exit(0);
})();
