const fs = require('fs');

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// 1. Update submitOrder to take parameter
tsx = tsx.replace(
  /const submitOrder = \(\) => \{/,
  "const submitOrder = (overrideSide?: 'buy' | 'sell') => {\n    const finalSide = overrideSide || side;"
);
tsx = tsx.replace(
  /side,/g,
  "finalSide,"
);
tsx = tsx.replace(
  /\$\{side\.toUpperCase\(\)\}/,
  "${finalSide.toUpperCase()}"
);
// fix the above replace since side is used in mapping userOrders etc. We should only replace inside submitOrder.
// Actually, let's just do a specific string replace:
