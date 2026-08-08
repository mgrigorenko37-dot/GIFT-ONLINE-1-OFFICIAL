const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldChartRegex = /<div\s*className='gx-chart'\s*ref=\{chartContainerRef\}\s*style=\{\{ height: '300px', width: '100%', padding: '0 12px' \}\}\s*><\/div>/;

const newChart = `<div className="chart-wrap" style={{ flex: 1, minHeight: 300 }}>
                <div className="chart-badge">DUROV_CAP_GIFT · 4ч</div>
                <div
                  className='gx-chart'
                  ref={chartContainerRef}
                  style={{ height: '100%', width: '100%' }}
                ></div>
              </div>`;

tsx = tsx.replace(oldChartRegex, newChart);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
