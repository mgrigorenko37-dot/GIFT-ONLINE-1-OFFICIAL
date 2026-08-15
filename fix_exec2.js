const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

code = code.replace(
  "await client.query('COMMIT');\n      return trade;",
  "console.log('returning trade!', trade);\n      await client.query('COMMIT');\n      return trade;"
);

fs.writeFileSync('server/tradingEngine.ts', code);
