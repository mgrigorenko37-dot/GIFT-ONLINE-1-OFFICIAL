const fs = require('fs');
let code = fs.readFileSync('tests/negative_balance.test.ts', 'utf8');

code = code.replace(
  "if (queryStr.includes('FROM te_orders WHERE user_id = $1 AND collateral_currency = $2')) {\n        return { rows: [], rowCount: 0 }; // wait, one order is open!\n      }",
  "if (queryStr.includes('FROM te_orders WHERE user_id = $1 AND collateral_currency = $2')) {\n        return { rows: [{ side: 'Buy', qty: 1, price: 100, reduce_only: false }], rowCount: 1 };\n      }"
);

// We should also set margin calculation config
// Actually, we just need to make sure the order mock returned has a price

fs.writeFileSync('tests/negative_balance.test.ts', code);
