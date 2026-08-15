const { Pool } = require('pg');
const fs = require('fs');

async function run() {
  const pool = new Pool({
    host: process.env.SQL_ADMIN_HOST || process.env.SQL_HOST,
    user: process.env.SQL_ADMIN_USER || process.env.SQL_USER,
    password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
  });

  try {
    const sql = fs.readFileSync('src/engine/db/init.sql', 'utf8');
    await pool.query(sql);
    console.log('DB Initialized');
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
