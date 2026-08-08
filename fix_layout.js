const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

function extractPanel(className) {
  let start = content.indexOf("<div className='gx-panel " + className + "'");
  if (start === -1) return null;
  let depth = 0;
  let i = start;
  while (i < content.length) {
    if (content.substr(i, 4) === '<div') {
      let j = i + 4;
      let selfClosing = false;
      while (j < content.length) {
        if (content[j] === '>') {
          if (content[j - 1] === '/') {
            selfClosing = true;
          }
          break;
        }
        j++;
      }
      if (!selfClosing) {
        depth++;
      }
      i += 3;
    } else if (content.substr(i, 5) === '</div') {
      depth--;
      if (depth === 0) {
        return content.substring(start, i + 6);
      }
    }
    i++;
  }
  return null;
}

const markets = extractPanel('gx-markets-panel');
const chart = extractPanel('gx-chart-panel');
const orders = extractPanel('gx-orders-panel');
const orderbook = extractPanel('gx-orderbook-panel');
const orderPanel = extractPanel('gx-order-panel');

const startIdx = content.indexOf("<section className='gx-terminal gx-terminal-grid'>");
let before = content.substring(
  0,
  startIdx + "<section className='gx-terminal gx-terminal-grid'>".length
);
let endIdx = content.indexOf('</section>', startIdx);
let after = content.substring(endIdx);

const newLayout = `
          <div className='gx-left-column' style={{ minHeight: 0 }}>
            ${markets}
          </div>
          <div className='gx-center-column' style={{ flex: 1, minHeight: 0 }}>
            ${chart}
            ${orders}
          </div>
          <div className='gx-right-column' style={{ minHeight: 0 }}>
            ${orderbook}
          </div>
          <div className='gx-far-right-column' style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            ${orderPanel}
          </div>
`;

content = before + newLayout + after;
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);

let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(
  /\.gx-terminal-grid \{\n\s+grid-template-columns: minmax\(400px, 1fr\) 280px 320px;\n\s+gap: 15px;\n\s+flex: 1;\n\s+min-height: 0;\n\}/,
  `.gx-terminal-grid {
  display: grid;
  grid-template-columns: 260px minmax(400px, 1fr) 280px 320px;
  gap: 15px;
  flex: 1;
  min-height: 0;
}`
);

// Add logo hider
css += `
/* Hide lightweight charts TradingView logo */
#tv-attr-logo,
.tv-lightweight-charts a {
  display: none !important;
}
`;

fs.writeFileSync('src/styles/site.css', css);
