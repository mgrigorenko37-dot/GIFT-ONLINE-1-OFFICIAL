const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// Use state instead of search params to avoid route side-effects and layout breaks
code = code.replace(
  "const giftId = searchParams.get('gift') || 'durov-cap';",
  "const [giftId, setGiftId] = useState(searchParams.get('gift') || 'durov-cap');"
);

// We need to import useState if not already there, but it is.
// Let's implement event delegation on mkt-list
const mktListOld = `<div className="mkt-list">
              {filteredGifts.length > 0 ? filteredGifts.map((gift) => (
                <div
                  key={gift.id}
                  className={\`mkt-row \${gift.id === (activeGift?.id || '') ? 'active' : ''}\`}
                  onClick={() => {
                    setSearchParams({ gift: gift.id });
                    setMktPanelOpen(false);
                  }}
                >`;

const mktListNew = `<div 
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
                >`;

code = code.replace(mktListOld, mktListNew);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
