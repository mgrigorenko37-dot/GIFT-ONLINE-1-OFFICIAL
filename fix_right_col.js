const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

tsx = tsx.replace(/<div className='col'>\s*<div className="panel-inner">/, "<div className='gx-right-column'>\n      <div className=\"panel-inner gx-panel\" style={{ display: 'flex', flexDirection: 'column' }}>");

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
