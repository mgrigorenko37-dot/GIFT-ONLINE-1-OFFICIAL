const fs = require('fs');
let content = fs.readFileSync('server/tradingEngine.ts', 'utf8');
content = content.replace(
  /status: 'Open' \| 'Closed' \| 'Liquidated' \| 'MarginCall' \| 'PendingLiquidation' \| 'LiquidationFailed';/,
  "status: 'Open' | 'Closed' | 'Liquidated' | 'MarginCall' | 'PendingLiquidation' | 'LiquidationFailed' | 'OPEN' | 'MARGIN_CALL' | 'PENDING_LIQUIDATION' | 'LIQUIDATED' | 'CLOSED' | 'LIQUIDATION_FAILED';"
);
fs.writeFileSync('server/tradingEngine.ts', content);
