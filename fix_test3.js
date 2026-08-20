const fs = require('fs');
let code = fs.readFileSync('tests/negative_balance.test.ts', 'utf8');

code = code.replace(
  "{ side: 'Buy', qty: 1, price: 100, reduce_only: false }",
  '{ remaining_qty: 1, price: 100 }'
);

fs.writeFileSync('tests/negative_balance.test.ts', code);
