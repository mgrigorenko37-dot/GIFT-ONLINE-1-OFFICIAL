const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const rightPanelRegex = /<div className='gx-right-column'>[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/;

const newRightPanel = `<div className='col'>
      <div className="panel-inner">

        <div className="side-tabs">
          <div className={\`side-tab buy \${side === 'buy' ? 'active' : ''}\`} id="tabBuy" onClick={() => setSide('buy')}>Купить</div>
          <div className={\`side-tab sell \${side === 'sell' ? 'active' : ''}\`} id="tabSell" onClick={() => setSide('sell')}>Продать</div>
        </div>

        <div className="type-row">
          <div className={\`type-item \${orderType === 'Limit' ? 'active' : ''}\`} data-type="limit" onClick={() => setOrderType('Limit')}>Лимит</div>
          <div className={\`type-item \${orderType === 'Market' ? 'active' : ''}\`} data-type="market" onClick={() => setOrderType('Market')}>Рынок</div>
        </div>

        <div className="field" style={{ opacity: orderType === 'Market' ? 0.4 : 1, pointerEvents: orderType === 'Market' ? 'none' : 'auto' }}>
          <span className="fl">Цена</span>
          <input type="text" id="priceInput" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" disabled={orderType === 'Market'} />
          <span className="unit">TON</span>
        </div>

        <div className="field">
          <span className="fl">Кол-во</span>
          <input type="text" id="qtyInput" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          <span className="unit">GIFT</span>
        </div>

        <div className="slider-row">
          <input 
            type="range" 
            id="pctSlider" 
            min="0" 
            max="100" 
            step="25"
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
            style={{ '--val': \`\${amount && price ? Math.min(100, Math.floor((Number(amount) / (side === 'buy' ? balance / (Number(price) || activeGift.floor) : 100)) * 100)) : 0}%\`} as any}
          />
          <div className="slider-marks">
            {[0, 25, 50, 75, 100].map(p => (
              <span key={p} data-p={p} onClick={() => {
                const percent = p;
                if (side === 'buy') {
                  const curPrice = orderType === 'Limit' ? Number(price) : recentTrades[0]?.price || activeGift.floor;
                  if (curPrice > 0) {
                    const maxShares = balance / curPrice;
                    setAmount(Math.floor(maxShares * (percent / 100)).toString());
                  }
                } else {
                  setAmount(Math.floor(100 * (percent / 100)).toString());
                }
              }}>{p}%</span>
            ))}
          </div>
        </div>

        <div className="summary">
          <div className="sum-row"><span>Доступно</span><b id="availVal">{formatGX(balance)} TON</b></div>
          <div className="sum-row"><span>Комиссия</span><b>0.25%</b></div>
          <div className="sum-row"><span>Итого</span><b id="totalVal">{formatGX((Number(price) || activeGift.floor) * (Number(amount) || 0))} TON</b></div>
        </div>

        <button className={\`cta \${side}\`} id="ctaBtn" onClick={() => submitOrder(side)}>
          {side === 'buy' ? 'Купить' : 'Продать'} DUROV_CAP
        </button>
      </div>
    </div>
  </section>`;

tsx = tsx.replace(rightPanelRegex, newRightPanel);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
