const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');
code = code.replace(
  /return null;/g,
  "console.log('return null at', new Error().stack.split('\\n')[1]); return null;"
);
fs.writeFileSync('server/tradingEngine.ts', code);
