const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// Add Market Stats to Chart Heading
content = content.replace(
  /<div className='gx-chart-price'>\s*<strong>[^<]*\{recentTrades\.length > 0[^<]*\?[^<]*:[^\}]*\}\s*<\/strong>\s*<span className='gx-positive'>\+\{activeGift\.change\}%<\/span>\s*<\/div>/g,
  `<div className='gx-chart-price'>
                  <strong>
                    {recentTrades.length > 0
                      ? formatGX(recentTrades[0].price)
                      : formatGX(activeGift.floor)}
                  </strong>
                  <span className='gx-positive'>+{activeGift.change}%</span>
                </div>
                <div className='gx-chart-stats'>
                  <div className='gx-stat'>
                    <small>24h High</small>
                    <span>{formatGX(activeGift.floor * 1.05)}</span>
                  </div>
                  <div className='gx-stat'>
                    <small>24h Low</small>
                    <span>{formatGX(activeGift.floor * 0.95)}</span>
                  </div>
                  <div className='gx-stat'>
                    <small>24h Vol(GX)</small>
                    <span>{activeGift.volume}</span>
                  </div>
                </div>`
);

// Update order panel slider
content = content.replace(
  /<div className='gx-order-percentages'>\s*\{\[25, 50, 75, 100\]\.map\(\(percent\) => \([\s\S]*?<\/button>\s*\)\)\s*<\/div>/,
  `<div className='gx-order-slider-container'>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  step="25"
                  className="gx-order-slider"
                  onChange={(e) => {
                    const percent = Number(e.target.value);
                    if (side === 'buy') {
                      const spendable = balance * (percent / 100);
                      const qty = spendable / Number(price || activeGift.floor);
                      setAmount(Math.floor(qty).toString());
                    } else {
                      setAmount(Math.floor(100 * (percent / 100)).toString());
                    }
                  }}
                />
                <div className='gx-order-percentages'>
                  {[0, 25, 50, 75, 100].map((percent) => (
                    <button
                      key={percent}
                      type='button'
                      onClick={() => {
                        if (side === 'buy') {
                          const spendable = balance * (percent / 100);
                          const qty = spendable / Number(price || activeGift.floor);
                          setAmount(Math.floor(qty).toString());
                        } else {
                          setAmount(Math.floor(100 * (percent / 100)).toString());
                        }
                      }}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              </div>`
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
