const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

tsx = tsx.replace(
  /<div className='gx-panel gx-chart-panel'>/,
  "<div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>"
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
