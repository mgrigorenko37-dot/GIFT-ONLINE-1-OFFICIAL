const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');
code = code.replace(
  /order\.feeCurrency,\s+'REJECTED',/g,
  "order.feeCurrency,\n              order.pnlCurrency || order.settlementCurrency,\n              'REJECTED',"
);
fs.writeFileSync('server/tradingEngine.ts', code);
