const fs = require('fs');
let code = fs.readFileSync('server/tradingEngineDb.test.ts', 'utf8');

// Find all `executeTrade(orderId,` and replace with `executeTrade(o.orderId,` in the last 3 tests.
// Actually I can just replace `orderId` with `o.orderId` generally in those blocks.
// Let's just do it manually.

code = code.replace(/engine\.executeTrade\(orderId/g, 'engine.executeTrade(o.orderId');
code = code.replace(
  /WHERE order_id = \$1', \[orderId\]\);/g,
  "WHERE order_id = $1', [o.orderId]);"
);

fs.writeFileSync('server/tradingEngineDb.test.ts', code);
