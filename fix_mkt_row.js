const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// I need to find the mkt-row and put GiftArtwork inside it
const oldRow = `<div className="left"><span className="n">{gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT</span><span className="vol">Vol {gift.volume}</span></div>`;
const newRow = `<div className="left" style={{flexDirection: 'row', alignItems: 'center', gap: '8px'}}>
  <GiftArtwork className={gift.className || ''} small emoji={gift.emoji} />
  <div style={{display: 'flex', flexDirection: 'column'}}>
    <span className="n">{gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT</span>
    <span className="vol">Vol {gift.volume}</span>
  </div>
</div>`;
code = code.replace(oldRow, newRow);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
console.log('Fixed mkt-row');
