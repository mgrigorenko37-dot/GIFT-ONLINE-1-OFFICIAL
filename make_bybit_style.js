const fs = require('fs');

let css = fs.readFileSync('src/styles/site.css', 'utf8');

// Update chart heading to look more like Bybit Ticker
css = css.replace(
  /\.gx-chart-heading \{[\s\S]*?\}/,
  `.gx-chart-heading {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 12px 16px;
  background: var(--gx-panel);
  border-bottom: 1px solid var(--gx-border);
}`
);

css = css.replace(
  /\.gx-chart-price \{[\s\S]*?\}/,
  `.gx-chart-price {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.gx-chart-price strong {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}
.gx-chart-price span {
  font-size: 12px;
}`
);

css += `
.gx-chart-stats {
  display: flex;
  align-items: center;
  gap: 24px;
}

.gx-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gx-stat small {
  color: var(--gx-muted);
  font-size: 11px;
}

.gx-stat span {
  color: var(--gx-text);
  font-size: 12px;
  font-weight: 500;
}

.gx-timeframes {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--gx-border);
  color: var(--gx-muted);
  font-size: 12px;
}

.gx-timeframes span {
  cursor: pointer;
}

.gx-timeframes span:hover {
  color: var(--gx-text);
}

.gx-timeframes span.is-active {
  color: var(--gx-accent);
}

/* Bybit Style Order Tabs */
.gx-order-tabs {
  display: flex;
  background: transparent !important;
  padding: 0 !important;
  gap: 0 !important;
  border-radius: 0 !important;
  border-bottom: 1px solid var(--gx-border);
  margin-bottom: 16px;
}

.gx-order-tabs button {
  flex: 1;
  border-radius: 0 !important;
  background: transparent !important;
  border-bottom: 2px solid transparent !important;
  height: 40px !important;
  font-size: 14px !important;
  color: var(--gx-muted) !important;
}

.gx-order-tabs button.is-buy {
  color: var(--gx-text) !important;
  border-bottom-color: var(--gx-green) !important;
}

.gx-order-tabs button.is-sell {
  color: var(--gx-text) !important;
  border-bottom-color: var(--gx-red) !important;
}

/* Bybit Style Inputs */
.gx-order-input {
  display: flex;
  align-items: center;
  height: 40px !important;
  background: rgba(255,255,255,0.04) !important;
  border: 1px solid transparent !important;
  border-radius: 4px !important;
  padding: 0 12px !important;
  margin-bottom: 12px;
}

.gx-order-input:focus-within {
  border-color: var(--gx-accent) !important;
}

.gx-order-input .gx-input-prefix {
  color: var(--gx-muted);
  font-size: 12px;
  margin-right: 8px;
  white-space: nowrap;
}

.gx-order-input input {
  flex: 1;
  text-align: right;
  font-size: 14px !important;
  font-weight: 500 !important;
}

.gx-order-input .gx-input-suffix {
  color: var(--gx-text) !important;
  font-size: 12px !important;
  margin-left: 8px;
  font-weight: 500 !important;
}

.gx-order-type {
  display: flex;
  gap: 16px !important;
  margin-bottom: 16px !important;
}

.gx-order-type button {
  font-size: 13px !important;
}

.gx-order-type button.is-active {
  color: var(--gx-text) !important;
}

.gx-input-label {
  display: block;
}
.gx-input-label > span {
  display: none; /* Hide the old label parts */
}

/* Slider Customization for Bybit look */
.gx-order-slider-container {
  margin-bottom: 24px;
}
.gx-order-slider {
  height: 2px !important;
  background: rgba(255,255,255,0.1) !important;
}
.gx-order-slider::-webkit-slider-thumb {
  width: 14px !important;
  height: 14px !important;
  border: 2px solid var(--gx-panel) !important;
}
`;

fs.writeFileSync('src/styles/site.css', css);

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// Update chart panel
const chartHeadingRegex = /<div className='gx-chart-heading'>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
const chartHeadingMatch = tsx.match(chartHeadingRegex);

if (chartHeadingMatch) {
  let newChartHeading = `<div className='gx-chart-heading'>
                <div className='gx-selected-gift'>
                  <GiftArtwork className={activeGift.className} small />
                  <div>
                    <h2>
                      {activeGift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT
                    </h2>
                    <a href="#" style={{ color: 'var(--gx-accent)', fontSize: 12, textDecoration: 'underline' }}>{activeGift.collection}</a>
                  </div>
                </div>
                <div className='gx-chart-price'>
                  <strong className={activeGift.change >= 0 ? 'gx-positive' : 'gx-negative'}>
                    {recentTrades.length > 0
                      ? formatGX(recentTrades[0].price)
                      : formatGX(activeGift.floor)}
                  </strong>
                  <span className='gx-muted'>{\`$\${(activeGift.floor * 0.5).toFixed(2)}\`}</span>
                </div>
                <div className='gx-chart-stats'>
                  <div className='gx-stat'>
                    <small>24h Change</small>
                    <span className={activeGift.change >= 0 ? 'gx-positive' : 'gx-negative'}>
                      {activeGift.change >= 0 ? '+' : ''}{activeGift.change}%
                    </span>
                  </div>
                  <div className='gx-stat'>
                    <small>24h High</small>
                    <span>{formatGX(activeGift.floor * 1.05)}</span>
                  </div>
                  <div className='gx-stat'>
                    <small>24h Low</small>
                    <span>{formatGX(activeGift.floor * 0.95)}</span>
                  </div>
                  <div className='gx-stat'>
                    <small>24h Turnover(GX)</small>
                    <span>{activeGift.volume}</span>
                  </div>
                </div>
              </div>
              <div className='gx-timeframes'>
                <span>Time</span>
                <span>1s</span>
                <span>1m</span>
                <span>5m</span>
                <span>15m</span>
                <span className='is-active'>30m</span>
                <span>1h</span>
                <span>4h</span>
                <span>1d</span>
                <span>1w</span>
                <span>1M</span>
                <span style={{ marginLeft: 'auto' }}><i className='material-icons' style={{ fontSize: 14 }}>settings</i></span>
              </div>`;
  tsx = tsx.replace(chartHeadingRegex, newChartHeading);
}

// Update Order Inputs
const limitInputRegex =
  /<label className='gx-input-label'>\s*Price <span>GX<\/span>\s*<div className='gx-order-input'>\s*<input([\s\S]*?)\/>\s*<span>GX<\/span>\s*<\/div>\s*<\/label>/;
tsx = tsx.replace(
  limitInputRegex,
  `<div className='gx-order-input'>
                    <span className='gx-input-prefix'>Order Price</span>
                    <input$1/>
                    <span className='gx-input-suffix'>GX</span>
                  </div>`
);

const amountInputRegex =
  /<label className='gx-input-label'>\s*Amount <span>SHARES<\/span>\s*<div className='gx-order-input'>\s*<input([\s\S]*?)\/>\s*<span>SHARES<\/span>\s*<\/div>\s*<\/label>/;
tsx = tsx.replace(
  amountInputRegex,
  `<div className='gx-order-input'>
                  <span className='gx-input-prefix'>Qty</span>
                  <input$1/>
                  <span className='gx-input-suffix'>Gift</span>
                </div>`
);

const submitRegex =
  /<button\s*type='button'\s*className={`gx-submit \$\{side === 'sell' \? 'gx-submit-sell' : ''\}`}[\s\S]*?<\/button>/;
tsx = tsx.replace(
  submitRegex,
  `<button
                type='button'
                className={\`gx-submit \${side === 'sell' ? 'gx-submit-sell' : ''}\`}
                onClick={submitOrder}
                style={{ height: 48, fontSize: 14 }}
              >
                {side === 'buy' ? 'Open Long' : 'Open Short'}
              </button>`
);

tsx = tsx.replace(/>\s*Buy\s*<\/button>/, '>Open</button>');
tsx = tsx.replace(/>\s*Sell\s*<\/button>/, '>Close</button>');

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
