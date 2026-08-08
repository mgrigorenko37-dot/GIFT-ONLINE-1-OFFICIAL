const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const sliderReplacement = `<div className='gx-order-slider-container'>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  step="25"
                  className="gx-order-slider"
                  value={amount && price ? Math.min(100, Math.floor((Number(amount) / (side === 'buy' ? balance / (Number(price) || activeGift.floor) : 100)) * 100)) : 0}
                  onChange={(e) => {
                    const percent = Number(e.target.value);
                    if (side === 'buy') {
                      const curPrice = orderType === 'Limit' ? Number(price) : recentTrades[0]?.price || activeGift.floor;
                      if (curPrice > 0) {
                        const maxShares = balance / curPrice;
                        setAmount(Math.floor(maxShares * (percent / 100)).toString());
                      }
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
                          const curPrice = orderType === 'Limit' ? Number(price) : recentTrades[0]?.price || activeGift.floor;
                          if (curPrice > 0) {
                            const maxShares = balance / curPrice;
                            setAmount(Math.floor(maxShares * (percent / 100)).toString());
                          }
                        } else {
                          setAmount(Math.floor(100 * (percent / 100)).toString());
                        }
                      }}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              </div>`;

content = content.replace(/<div className='gx-percent-row'>[\s\S]*?<\/div>/, sliderReplacement);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
