const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// 1. Add state for variants and expanded row
const stateHooks = `  const [mktPanelOpen, setMktPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeframe, setTimeframe] = useState('4h');
  const filteredGifts = gifts.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));
  
  const [expandedGiftId, setExpandedGiftId] = useState<string | null>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<any>(null);

  useEffect(() => {
    if (expandedGiftId) {
      setVariantLoading(true);
      fetch(\`/api/variants/\${expandedGiftId}\`)
        .then(res => res.json())
        .then(data => {
          setVariants(data);
          setVariantLoading(false);
        })
        .catch(() => setVariantLoading(false));
    } else {
      setVariants([]);
    }
  }, [expandedGiftId]);`;

code = code.replace(
  /  const \[mktPanelOpen, setMktPanelOpen\] = useState\(false\);\n  const \[searchQuery, setSearchQuery\] = useState\(''\);\n  const \[timeframe, setTimeframe\] = useState\('4h'\);\n  const filteredGifts = gifts\.filter\(g => g\.name\.toLowerCase\(\)\.includes\(searchQuery\.toLowerCase\(\)\)\);/,
  stateHooks
);

// 2. Add CSS for variants
const cssInsert = `          .trade-wrapper .mkt-row:hover { background: var(--panel); }
          .trade-wrapper .mkt-row.active { background: rgba(242,184,75,.08); }
          .trade-wrapper .variants-list { display: flex; flex-direction: column; gap: 4px; padding: 4px 10px 10px; background: rgba(0,0,0,0.1); border-radius: 0 0 7px 7px; margin-top: -4px; margin-bottom: 4px; }
          .trade-wrapper .variant-card { display: flex; align-items: center; justify-content: space-between; padding: 6px; border-radius: 5px; cursor: pointer; transition: .1s; border: 1px solid transparent; }
          .trade-wrapper .variant-card:hover { border-color: var(--line); background: var(--panel-2); }
          .trade-wrapper .variant-card.active { background: rgba(242,184,75,.08); border-color: rgba(242,184,75,.2); }
          .trade-wrapper .variant-left { display: flex; align-items: center; gap: 8px; }
          .trade-wrapper .variant-img { width: 24px; height: 24px; border-radius: 4px; background: var(--panel); object-fit: cover; }
          .trade-wrapper .variant-info { display: flex; flex-direction: column; gap: 2px; }
          .trade-wrapper .variant-name { font-size: 11px; font-weight: 600; color: var(--text); }
          .trade-wrapper .variant-rarity { font-size: 9px; color: var(--gold); }
          .trade-wrapper .variant-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
          .trade-wrapper .variant-price { font-size: 11px; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
          .trade-wrapper .mkt-row .left { display: flex; flex-direction: column; gap: 2px; }`;

code = code.replace(
  /          \.trade-wrapper \.mkt-row:hover \{ background: var\(--panel\); \}\n          \.trade-wrapper \.mkt-row\.active \{ background: rgba\(242,184,75,\.08\); \}\n          \.trade-wrapper \.mkt-row \.left \{ display: flex; flex-direction: column; gap: 2px; \}/,
  cssInsert
);

// 3. Update the markup for the list
const mktListOld = `<div 
              className="mkt-list" 
              onClick={(e) => {
                const row = (e.target as HTMLElement).closest('.mkt-row');
                if (row) {
                  const id = row.getAttribute('data-id');
                  if (id) {
                    setGiftId(id);
                    setSearchParams({ gift: id });
                    setMktPanelOpen(false);
                  }
                }
              }}
            >
              {filteredGifts.length > 0 ? filteredGifts.map((gift) => (
                <div
                  key={gift.id}
                  data-id={gift.id}
                  className={\`mkt-row \${gift.id === (activeGift?.id || '') ? 'active' : ''}\`}
                >
                  <div className="left"><span className="n">{gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT</span><span className="vol">Vol {gift.volume}</span></div>
                  <div className="right">
                    <span className="p">{formatGX(gift.floor)}</span>
                    <span className={\`c \${gift.change >= 0 ? 'up' : 'down'}\`}>{gift.change >= 0 ? '+' : ''}{gift.change}%</span>
                  </div>
                </div>
              )) : (
                <div className="mkt-empty">Ничего не найдено</div>
              )}
            </div>`;

const mktListNew = `<div className="mkt-list">
              {filteredGifts.length > 0 ? filteredGifts.map((gift) => (
                <React.Fragment key={gift.id}>
                  <div
                    className={\`mkt-row \${gift.id === (activeGift?.id || '') ? 'active' : ''}\`}
                    onClick={() => {
                      if (expandedGiftId === gift.id) {
                        setExpandedGiftId(null);
                      } else {
                        setExpandedGiftId(gift.id);
                        setGiftId(gift.id);
                        setSearchParams({ gift: gift.id });
                        setSelectedVariant(null);
                      }
                    }}
                  >
                    <div className="left"><span className="n">{gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT</span><span className="vol">Vol {gift.volume}</span></div>
                    <div className="right">
                      <span className="p">{formatGX(gift.floor)}</span>
                      <span className={\`c \${gift.change >= 0 ? 'up' : 'down'}\`}>{gift.change >= 0 ? '+' : ''}{gift.change}%</span>
                    </div>
                  </div>
                  {expandedGiftId === gift.id && (
                    <div className="variants-list">
                      {variantLoading ? (
                        <div style={{fontSize: 10, color: 'var(--muted)', padding: 4}}>Загрузка дизайнов...</div>
                      ) : variants.length > 0 ? (
                        variants.map(v => (
                          <div 
                            key={v.id} 
                            className={\`variant-card \${selectedVariant?.id === v.id ? 'active' : ''}\`}
                            onClick={() => {
                              setSelectedVariant(v);
                              // We could update the chart or terminal to trade this specific variant
                              setGiftId(v.id);
                              setSearchParams({ gift: v.id });
                              setMktPanelOpen(false);
                            }}
                          >
                            <div className="variant-left">
                              {v.image_url ? (
                                <img src={v.image_url} alt="" className="variant-img" />
                              ) : (
                                <div className="variant-img" style={{background: v.backdrop_color}} />
                              )}
                              <div className="variant-info">
                                <span className="variant-name">{v.model_name} {v.symbol_name !== 'None' ? \`+ \${v.symbol_name}\` : ''}</span>
                                <span className="variant-rarity">{v.rarity_percentage}% Rarity</span>
                              </div>
                            </div>
                            <div className="variant-right">
                              <span className="variant-price">{formatGX(v.current_price_gx)}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{fontSize: 10, color: 'var(--muted)', padding: 4}}>Нет уникальных дизайнов</div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              )) : (
                <div className="mkt-empty">Ничего не найдено</div>
              )}
            </div>`;

code = code.replace(mktListOld, mktListNew);

// 4. Also update activeGift to potentially use selectedVariant data for the header
const headerOld = `<div className="asset-price mono">{recentTrades.length > 0 ? formatGX(recentTrades[0].price) : formatGX((activeGift?.floor || 0))}</div>
              <span className={\`chg-tag \${(activeGift?.change || 0) >= 0 ? 'chg-up' : 'chg-down'}\`}>{(activeGift?.change || 0) >= 0 ? '+' : ''}{(activeGift?.change || 0)}%</span>`;

const headerNew = `<div className="asset-price mono">{recentTrades.length > 0 ? formatGX(recentTrades[0].price) : formatGX((selectedVariant ? selectedVariant.current_price_gx : (activeGift?.floor || 0)))}</div>
              <span className={\`chg-tag \${(activeGift?.change || 0) >= 0 ? 'chg-up' : 'chg-down'}\`}>{(activeGift?.change || 0) >= 0 ? '+' : ''}{(activeGift?.change || 0)}%</span>`;

code = code.replace(headerOld, headerNew);

const titleOld = `<div className="crumbs">Markets <span>›</span> <b>{(activeGift?.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}</b></div>`;
const titleNew = `<div className="crumbs">Markets <span>›</span> <b>{(activeGift?.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')} {selectedVariant ? \` / \${selectedVariant.model_name.toUpperCase()}\` : ''}</b></div>`;
code = code.replace(titleOld, titleNew);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
console.log('Updated UI!');
