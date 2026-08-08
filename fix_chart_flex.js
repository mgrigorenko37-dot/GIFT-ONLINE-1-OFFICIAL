const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

tsx = tsx.replace(
  /<div\s+className='gx-chart'\s+ref=\{chartContainerRef\}\s+style=\{\{ height: '300px', width: '100%', padding: '0 12px' \}\}\s+><\/div>/,
  "<div className='gx-chart-container' style={{ flex: 1, minHeight: 0, position: 'relative' }}>\\n                <div ref={chartContainerRef} className='gx-chart' style={{ position: 'absolute', inset: 0, paddingLeft: 12, paddingRight: 12 }} />\\n              </div>"
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
