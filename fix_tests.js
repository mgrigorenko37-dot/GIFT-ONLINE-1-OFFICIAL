const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

code = code.replace(
  "'INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees) VALUES ($1, $2, $3, $4, 0, 0)',",
  "'INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, 0, $5, $5)',"
);
code = code.replace(
  "[userId, currency, available, locked]",
  "[userId, currency, available, locked, Date.now()]"
);

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
