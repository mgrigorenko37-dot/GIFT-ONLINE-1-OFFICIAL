const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');
code = code.replace(
  "await engine.executeTrade(order.orderId, 1, 10, 't_liq_1'); console.log(await engine.getAllPositions(userId));",
  "const execOrder = await engine.executeTrade(order.orderId, 1, 10, 't_liq_1'); console.log('execOrder:', execOrder); console.log(await engine.getAllPositions(userId));"
);
fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
