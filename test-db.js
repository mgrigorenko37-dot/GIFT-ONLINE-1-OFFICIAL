const { Pool } = require('pg');
require('dotenv').config();
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query('SELECT * FROM gift_collections')
  .then((r) => {
    console.log('gift_collections:', r.rows);
    p.end();
  })
  .catch((e) => {
    console.log('Error:', e);
    p.end();
  });
