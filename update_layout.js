const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

function extractPanel(className) {
  let start = content.indexOf("<div className='gx-panel " + className + "'");
  if (start === -1) {
    start = content.indexOf("<div\\n              className='gx-panel " + className + "'");
  }

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

console.log('Panels found:', !!markets, !!chart, !!orders, !!orderbook, !!orderPanel);

if (markets && chart && orders && orderbook && orderPanel) {
  const startIdx = content.indexOf("<section className='gx-terminal-grid'>");
  let before = content.substring(0, startIdx + "<section className='gx-terminal-grid'>".length);
  let endIdx = content.indexOf('</section>', startIdx);
  let after = content.substring(endIdx);

  const newLayout = `
          <div className='gx-far-left-column' style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            ${markets}
          </div>
          <div className='gx-left-column' style={{ flex: 1, minHeight: 0 }}>
            ${chart}
            ${orders}
          </div>
          <div className='gx-center-column' style={{ minHeight: 0 }}>
            ${orderbook}
          </div>
          <div className='gx-right-column' style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            ${orderPanel}
          </div>
`;
  content = before + newLayout + after;
  fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
  console.log('Layout updated successfully.');
} else {
  console.log('Missing panels, did not update layout.');
}

let css = fs.readFileSync('src/styles/site.css', 'utf8');

// Ensure gx-terminal-grid has 4 columns now
css = css.replace(
  /\.gx-terminal-grid \{\n\s+display: grid;\n\s+grid-template-columns: minmax\(400px, 1fr\) 280px 320px;\n\s+gap: 15px;\n\s+flex: 1;\n\s+min-height: 0;\n\}/g,
  `.gx-terminal-grid {
  display: grid;
  grid-template-columns: 260px minmax(400px, 1fr) 280px 320px;
  gap: 15px;
  flex: 1;
  min-height: 0;
}`
);

// Add logo hider
if (!css.includes('#tv-attr-logo')) {
  css += `
/* Hide lightweight charts TradingView logo */
#tv-attr-logo,
.tv-lightweight-charts a {
  display: none !important;
}

.gx-far-left-column {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.gx-far-left-column .gx-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
`;
}

// Ensure the 4 columns apply flex correctly
css = css.replace(
  /\.gx-left-column,\n\s+\.gx-center-column,\n\s+\.gx-right-column \{\n\s+display: flex;/g,
  `.gx-far-left-column,
.gx-left-column,
.gx-center-column,
.gx-right-column {
  display: flex;`
);

css = css.replace(
  /\.gx-left-column \.gx-panel,\n\s+\.gx-center-column \.gx-panel,\n\s+\.gx-right-column \.gx-panel \{\n\s+display: flex;/g,
  `.gx-far-left-column .gx-panel,
.gx-left-column .gx-panel,
.gx-center-column .gx-panel,
.gx-right-column .gx-panel {
  display: flex;`
);

fs.writeFileSync('src/styles/site.css', css);
