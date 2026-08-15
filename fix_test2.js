const fs = require('fs');
let code = fs.readFileSync('tests/negative_balance.test.ts', 'utf8');

code = code.replace("price: 0,", "price: 100,");

fs.writeFileSync('tests/negative_balance.test.ts', code);
