const fs = require('fs');
let code = fs.readFileSync('server/dbSchema.ts', 'utf-8');

// Fix the over-eager UNIQUE constraint insertion
code = code.replace(
  /CREATE TABLE IF NOT EXISTS te_position_snapshots \([\s\S]*?valid_to BIGINT/m,
  (match) => {
    let fixed = match.replace(/UNIQUE\(user_id, instrument_key\),\s*/, '');
    if (!fixed.includes('status VARCHAR')) {
      fixed = fixed.replace(
        'qty NUMERIC NOT NULL,',
        'qty NUMERIC NOT NULL,\n        status VARCHAR(32) NOT NULL,'
      );
    }
    return fixed;
  }
);

fs.writeFileSync('server/dbSchema.ts', code);

// Fix postgres
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
  await pool
    .query(
      'ALTER TABLE te_position_snapshots DROP CONSTRAINT IF EXISTS te_position_snapshots_user_id_instrument_key_key'
    )
    .catch((e) => console.error(e));
  await pool
    .query("ALTER TABLE te_position_snapshots ADD COLUMN status VARCHAR(32) DEFAULT 'Open'")
    .catch((e) => console.error(e));
  process.exit(0);
})();
