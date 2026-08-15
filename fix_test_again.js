const fs = require('fs');
let code = fs.readFileSync('server/tradingEngineDb.test.ts', 'utf8');

code = code.replace(
  /const orderId = crypto\.randomUUID\(\);\n\s*await engine\.placeOrder\(\{\n\s*orderId,/g,
  'const o = await engine.placeOrder({'
);
code = code.replace(
  /await engine\.placeOrder\(\{\n\s*orderId,/g,
  'const o = await engine.placeOrder({'
);

// wait, the previous block is:
/*
    const orderId = crypto.randomUUID();
    await engine.placeOrder({
      orderId,
      userId: 'user1',
*/
code = code.replace(
  /const orderId = crypto\.randomUUID\(\);\n\s*await engine\.placeOrder\(\{\n\s*orderId,/g,
  'const o = await engine.placeOrder({'
);

fs.writeFileSync('server/tradingEngineDb.test.ts', code);
