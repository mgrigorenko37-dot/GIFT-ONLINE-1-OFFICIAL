const fs = require('fs');

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldInputsRegex = /\{orderType === 'Limit' && \([\s\S]*?<span className='gx-input-suffix'>BTC<\/span>\s*<\/div>/;

const newInputs = `{orderType === 'Limit' && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#B7BDC6', fontSize: 12, marginBottom: 4 }}>
                    <span>Цена следования</span>
                    <span>Интервал: 1 с</span>
                  </div>
                  <div className='gx-order-input' style={{ marginBottom: 4 }}>
                    <input
                      value={price || 'Спрос1/предложение1'}
                      onChange={(e) => setPrice(e.target.value)}
                      inputMode='decimal'
                      style={{ textAlign: 'left', fontSize: 12 }}
                    />
                    <span className='gx-input-suffix'>▾</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#EAECEF' }}>Спрос1 <span className='gx-positive'>{activeGift.floor.toFixed(2)}</span></span>
                    <span style={{ color: '#EAECEF' }}>Предложение1 <span className='gx-negative'>{(activeGift.floor + 0.1).toFixed(2)}</span></span>
                  </div>
                </div>
              )}

              <div className='gx-order-input' style={{ marginTop: 12 }}>
                  <span className='gx-input-prefix'>К-во</span>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode='decimal'
                    placeholder=''
                  />
                  <span className='gx-input-suffix'>BTC ⇄</span>
                </div>`;

tsx = tsx.replace(oldInputsRegex, newInputs);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
