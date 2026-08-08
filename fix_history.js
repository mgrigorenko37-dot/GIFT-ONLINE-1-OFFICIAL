const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldEmpty = `<div className="orders-empty">\n              {userOrders.length === 0 ? 'Нет открытых ордеров' : userOrders.map(o => (\n                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1E222C' }}>\n                  <span>{o.side === 'buy' ? 'Покупка' : 'Продажа'} {o.amount} {o.giftName}</span>\n                  <span>{o.price} TON</span>\n                </div>\n              ))}\n            </div>`;

const newEmpty = `<div className="orders-empty">\n              {activityTab === 'history' ? 'История пуста' : userOrders.length === 0 ? 'Нет открытых ордеров' : userOrders.map(o => (\n                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1E222C' }}>\n                  <span>{o.side === 'buy' ? 'Покупка' : 'Продажа'} {o.amount} {o.giftName}</span>\n                  <span>{o.price} TON</span>\n                </div>\n              ))}\n            </div>`;

if (code.includes(oldEmpty)) {
  code = code.replace(oldEmpty, newEmpty);
  fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
}
