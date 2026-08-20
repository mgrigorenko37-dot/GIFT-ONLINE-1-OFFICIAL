const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');
code = code.replace("side: 'Buy'", "side: 'Sell'"); // place short
code = code.replace("updateMarkPrice('TON-USD', 0.4)", "updateMarkPrice('TON-USD', 30)"); // increase price
code = code.replace(
  'Liquidation of Long position when mark price drops below maintenance margin',
  'Liquidation of Short position when mark price rises above maintenance margin'
);
fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
