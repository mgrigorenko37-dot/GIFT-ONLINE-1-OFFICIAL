const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');
let num = 0;
code = code.replace(/return null;/g, () => {
  num++;
  return `console.log('returning null from ${num}'); return null;`;
});
fs.writeFileSync('server/tradingEngine.ts', code);
