const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query('SELECT current_schema(), current_user');
    console.log('Current schema/user:', res.rows[0]);

    // Check permissions on public schema
    const perms = await client.query(
      `SELECT has_schema_privilege(current_user, 'public', 'USAGE') as usage_priv, has_schema_privilege(current_user, 'public', 'CREATE') as create_priv`
    );
    console.log('Permissions:', perms.rows[0]);
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
