const fs = require('fs');
const lines = fs.readFileSync('server/tradingEngine.ts', 'utf8').split('\n');
lines.forEach((l, i) => {
  if (l.includes('return null')) console.log(`Line ${i + 1}: ${l}`);
});
