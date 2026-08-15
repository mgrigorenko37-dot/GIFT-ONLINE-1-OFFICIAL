const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

code = code.replace(
  /\.trade-wrapper \.mkt-panel {\n            position: absolute;/,
  '.trade-wrapper .mkt-panel {\n            position: absolute; z-index: 40;'
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
