const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query(
      'CREATE TEMP TABLE te_balances_test (user_id VARCHAR(255) PRIMARY KEY, available_balance NUMERIC)'
    );
    await client.query("INSERT INTO te_balances_test VALUES ('user1', 100)");
    await client.query(
      "ALTER TABLE te_balances_test ADD COLUMN IF NOT EXISTS currency VARCHAR(20) DEFAULT 'TON'"
    );
    await client.query(
      "UPDATE te_balances_test SET currency = 'TON' WHERE currency IS NULL OR currency = ''"
    );

    await client.query(`
      DO $$
      DECLARE
        pk_name TEXT;
        col_count INT;
      BEGIN
        SELECT tc.constraint_name, COUNT(kcu.column_name) 
        INTO pk_name, col_count
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name 
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = 'te_balances_test' 
          AND tc.constraint_type = 'PRIMARY KEY'
        GROUP BY tc.constraint_name;

        IF pk_name IS NOT NULL AND col_count = 1 THEN
          EXECUTE 'ALTER TABLE te_balances_test DROP CONSTRAINT ' || pk_name;
          EXECUTE 'ALTER TABLE te_balances_test ADD PRIMARY KEY (user_id, currency)';
        ELSIF pk_name IS NULL THEN
          EXECUTE 'ALTER TABLE te_balances_test ADD PRIMARY KEY (user_id, currency)';
        END IF;
      END $$;
    `);

    const res = await client.query('SELECT * FROM te_balances_test');
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    client.release();
    pool.end();
  }
}
run();
