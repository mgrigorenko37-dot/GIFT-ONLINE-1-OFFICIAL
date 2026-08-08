const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

code = code.replace(
  "{['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'].map((tf) => (",
  "{['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'].map((tf) => ("
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
