const { Pool } = require('pg');
async function run() {
  const p = new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
  });
  try {
    const res = await p.query("SELECT count(*) FROM gift_variants WHERE image_url != ''");
    console.log('Variants with images:', res.rows[0].count);
    const res2 = await p.query('SELECT count(*) FROM gift_variants');
    console.log('Total variants:', res2.rows[0].count);
  } finally {
    await p.end();
  }
}
run();
