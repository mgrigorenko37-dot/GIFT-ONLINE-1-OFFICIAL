const fs = require('fs');
let code = fs.readFileSync('server/dbSchema.ts', 'utf-8');
code = code.replace(/currency VARCHAR\(32\) NOT NULL,\n\s*/, '');
fs.writeFileSync('server/dbSchema.ts', code);

const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
  await pool
    .query('ALTER TABLE te_position_snapshots DROP COLUMN IF EXISTS currency')
    .catch((e) => console.error(e));
  process.exit(0);
})();
