const fs = require('fs');
let code = fs.readFileSync('server/tradingEngineDb.test.ts', 'utf8');

let lines = code.split('\n');

// Find line 180 or 181 that contains `});`
const closingIndex = lines.findIndex((line, i) => i > 170 && i < 185 && line.trim() === '});');
if (closingIndex !== -1) {
  lines.splice(closingIndex, 1);
  lines.push('});');

  // replace client.query with pool.query
  code = lines.join('\n').replace(/client\.query/g, 'pool.query');
  fs.writeFileSync('server/tradingEngineDb.test.ts', code);
  console.log('Fixed');
}
