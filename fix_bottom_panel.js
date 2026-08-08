const fs = require('fs');

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldSummaryRegex = /<div className='gx-order-summary'>[\s\S]*?<\/div>\s*<div style=\{\{ display: 'flex', gap: 12, marginTop: 16 \}\}>/;

const newSummary = `<div style={{ display: 'flex', justifyContent: 'space-between', color: '#EAECEF', fontSize: 12, fontWeight: 500, margin: '16px 0 12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Расширенные настройки
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#F6465D', display: 'inline-block' }}></span>
                </span>
                <span>▾</span>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>`;

tsx = tsx.replace(oldSummaryRegex, newSummary);

const oldButtonsRegex = /<button[\s\S]*?Открыть Short\s*<\/button>\s*<\/div>/;

const buttonsMatch = tsx.match(oldButtonsRegex);

if (buttonsMatch) {
  const newFooter = `${buttonsMatch[0]}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#B7BDC6', fontSize: 12, marginTop: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className='material-icons' style={{ fontSize: 14 }}>percent</i> Ставка комиссии
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#F6465D', display: 'inline-block' }}></span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className='material-icons' style={{ fontSize: 14 }}>calculate</i> Калькулятор
                </span>
              </div>
              
              <div style={{ borderTop: '1px solid var(--gx-border)', marginTop: 16, paddingTop: 16, color: '#EAECEF', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
                    Единый торговый акка... <i className='material-icons' style={{ fontSize: 14 }}>visibility_off</i>
                  </span>
                  <span style={{ color: '#F7A600' }}><i className='material-icons' style={{ fontSize: 14 }}>bar_chart</i> P&L</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#B7BDC6', marginBottom: 4 }}>
                  <span>Режим маржи</span>
                  <span style={{ color: '#EAECEF' }}>Кросс-маржа ❯</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#B7BDC6', marginBottom: 4 }}>
                  <span>Начальная маржа</span>
                  <span style={{ color: '#EAECEF' }}>0.00%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#B7BDC6' }}>
                  <span>Поддерживающая маржа</span>
                  <span style={{ color: '#EAECEF' }}>0.00%</span>
                </div>
              </div>`;

  tsx = tsx.replace(oldButtonsRegex, newFooter);
}

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
