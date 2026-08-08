const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// Replace gx-terminal-grid classes
tsx = tsx.replace(/<section className='gx-terminal gx-terminal-grid'>/, "<section className='layout'>");
tsx = tsx.replace(/<div className='gx-left-column' style={{ flex: 1, minHeight: 0 }}>/, "<div className='col' style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>");

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
