const fs = require('fs');

let code = fs.readFileSync('server/tradingEngineDb.test.ts', 'utf8');

code = code.replace(
  /await pool\.query\('INSERT INTO te_balances \(user_id, balance, updated_at\) VALUES \(\$1, \$2, \$3\)', \['user1', 10000, Date\.now\(\)\]\);/g,
  `await pool.query("INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'TON', $2, $3, $3)", ['user1', 10000, Date.now()]);`
);

fs.writeFileSync('server/tradingEngineDb.test.ts', code);
