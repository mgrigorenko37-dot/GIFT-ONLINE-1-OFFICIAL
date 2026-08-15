const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// Replace the price heading
const oldHeadingRegex =
  /<div className='gx-chart-heading'>[\s\S]*?<\/div>\s*<div className='gx-timeframes'>[\s\S]*?<\/div>/;

const newHeading = `<div className="price-head">
        <div>
          <div className="asset-name">DUROV_CAP_GIFT / TON</div>
          <div className="asset-price mono">
            {recentTrades.length > 0 ? formatGX(recentTrades[0].price) : formatGX(activeGift.floor)}
            <span className={\`chg-tag \${activeGift.change >= 0 ? 'chg-up' : 'chg-down'}\`}>
              {activeGift.change >= 0 ? '+' : ''}{activeGift.change}%
            </span>
          </div>
        </div>
        <div className="stats">
          <div className="stat"><div className="l">24ч максимум</div><div className="v mono">{formatGX(activeGift.floor * 1.05)}</div></div>
          <div className="stat"><div className="l">24ч минимум</div><div className="v mono">{formatGX(activeGift.floor * 0.95)}</div></div>
          <div className="stat"><div className="l">Объём 24ч</div><div className="v mono">{activeGift.volume} шт</div></div>
        </div>
      </div>

      <div className="chart-toolbar" id="tfRow">
        <button type="button" className="tf-btn">15м</button>
        <button type="button" className="tf-btn">1ч</button>
        <button type="button" className="tf-btn active">4ч</button>
        <button type="button" className="tf-btn">1д</button>
        <button type="button" className="tf-btn">1н</button>
      </div>`;

tsx = tsx.replace(oldHeadingRegex, newHeading);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
