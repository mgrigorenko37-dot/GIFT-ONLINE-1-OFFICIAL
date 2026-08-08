const fs = require('fs');

let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

function extractPanel(className) {
  let start = content.indexOf("<div className='gx-panel " + className + "'");
  if (start === -1) return null;
  let depth = 0;
  let i = start;
  while (i < content.length) {
    if (content.substr(i, 4) === '<div') {
      // check if it's self closing by looking ahead for >
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
      i += 3; // skip past div
    } else if (content.substr(i, 5) === '</div') {
      depth--;
      if (depth === 0) {
        return content.substring(start, i + 6); // + </div>
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

console.log('Found:', !!markets, !!chart, !!orders, !!orderbook, !!orderPanel);

const startIdx = content.indexOf("<section className='gx-terminal gx-terminal-grid'>");
let before = content.substring(
  0,
  startIdx + "<section className='gx-terminal gx-terminal-grid'>".length
);

let endIdx = content.indexOf('</section>', startIdx);
let after = content.substring(endIdx);

const newLayout = `
          <div className='gx-left-column' style={{ flex: 1, minHeight: 0 }}>
            ${chart}
            ${orders}
          </div>
          <div className='gx-center-column' style={{ minHeight: 0 }}>
            ${orderbook}
          </div>
          <div className='gx-right-column' style={{ minHeight: 0 }}>
            ${orderPanel}
            ${markets}
          </div>
`;

content = before + newLayout + after;
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
