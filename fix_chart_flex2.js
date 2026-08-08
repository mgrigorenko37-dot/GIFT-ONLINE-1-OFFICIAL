const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

tsx = tsx.replace(
  /              <div className='gx-chart-container' style=\{\{ flex: 1, minHeight: 0, position: 'relative' \}\}>\\n                <div ref=\{chartContainerRef\} className='gx-chart' style=\{\{ position: 'absolute', inset: 0, paddingLeft: 12, paddingRight: 12 \}\} \/>\\n              <\/div>/,
  `              <div className='gx-chart-container' style={{ flex: 1, minHeight: 0, position: 'relative', margin: '0 12px 12px' }}>
                <div ref={chartContainerRef} className='gx-chart' style={{ position: 'absolute', inset: 0 }} />
              </div>`
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
