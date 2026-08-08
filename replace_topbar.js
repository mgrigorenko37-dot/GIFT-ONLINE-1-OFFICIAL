const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const topbarRegex = /<header className='bybit-global-header'>[\s\S]*?<\/header>/;
const newTopbar = `<div className="topbar">
          <div className="brand">
            <div className="brand-mark">🎁</div>
            <div className="crumbs">Markets <span>›</span> <b>DUROV_CAP</b></div>
          </div>
          <div className="live-pill"><span className="dot"></span> Live · обновлено только что</div>
        </div>`;

tsx = tsx.replace(topbarRegex, newTopbar);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
