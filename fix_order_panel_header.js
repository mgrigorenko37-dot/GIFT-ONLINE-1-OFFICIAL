const fs = require('fs');

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const marginHeader = `<div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: 'none', color: '#B7BDC6', height: 32, fontSize: 12, borderRadius: 4 }}>
                  Марж. торговля ▾
                </button>
                <button style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: 'none', color: '#B7BDC6', height: 32, fontSize: 12, borderRadius: 4 }}>
                  50.00x ▾
                </button>
              </div>
              <div className='gx-order-tabs'>`;

tsx = tsx.replace(/<div className='gx-order-tabs'>/, marginHeader);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
