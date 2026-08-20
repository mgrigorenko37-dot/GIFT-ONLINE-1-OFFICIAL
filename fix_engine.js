const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

// There are multiple imports of gifts now:
const pieces = code.split("  import { gifts } from '../src/data/gifts';");
if (pieces.length === 3) {
  // It happened twice! Wait, why twice?
  // Let's just restore the file from before I ran update_cancelOrder.js
}
