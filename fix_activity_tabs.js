const fs = require('fs');

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldTabsRegex = /<div className='gx-activity-tabs'>[\s\S]*?<\/div>\s*<\/div>/;

const newTabs = `<div className='gx-activity-tabs' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <button
                      type='button'
                      className={activityTab === 'open' ? 'is-active' : ''}
                      onClick={() => setActivityTab('open')}
                    >
                      Открытые ордера (0)
                    </button>
                    <button
                      type='button'
                      className={activityTab === 'positions' ? 'is-active' : ''}
                      onClick={() => setActivityTab('positions')}
                    >
                      Позиции (0)
                    </button>
                    <button
                      type='button'
                      className={activityTab === 'history' ? 'is-active' : ''}
                      onClick={() => setActivityTab('history')}
                    >
                      История Ордеров
                    </button>
                    <button
                      type='button'
                      className={activityTab === 'trades' ? 'is-active' : ''}
                      onClick={() => setActivityTab('trades')}
                    >
                      История торговли
                    </button>
                    <button type='button'>Активы</button>
                    <button type='button'>Займы (0)</button>
                    <button type='button'>Инструменты (0)</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#B7BDC6' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked style={{ accentColor: '#F7A600' }} />
                      Все рынки
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      Все инструменты ▾
                    </label>
                  </div>
                </div>
              </div>`;

tsx = tsx.replace(oldTabsRegex, newTabs);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);

let css = fs.readFileSync('src/styles/site.css', 'utf8');
css = css.replace(
  /\.gx-activity-tabs button\.is-active \{[\s\S]*?\}/,
  `.gx-activity-tabs button.is-active {
  color: #F7A600;
  border-bottom-color: #F7A600;
}`
);

fs.writeFileSync('src/styles/site.css', css);

