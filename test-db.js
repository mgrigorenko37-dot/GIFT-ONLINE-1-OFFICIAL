require('dotenv').config();
const { Pool } = require('pg');
async function run() {
  const pool = new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
  });
  try {
    const res = await pool.query('SELECT current_user, current_database()');
    console.log('User Info:', res.rows);
    const schemas = await pool.query('SELECT schema_name FROM information_schema.schemata');
    console.log('Schemas:', schemas.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
