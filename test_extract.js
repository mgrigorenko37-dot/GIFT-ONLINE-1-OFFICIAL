const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

function extractPanel(className) {
  let start = content.indexOf("<div className='gx-panel " + className + "'");
  if (start === -1) return 'not found';
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content.substr(i, 4) === '<div') {
      depth++;
    } else if (content.substr(i, 5) === '</div') {
      depth--;
      if (depth === 0) {
        return content.substring(start, i + 6);
      }
    }
  }
  return 'did not terminate, depth=' + depth;
}

const res = extractPanel('gx-orderbook-panel');
console.log(res.length > 200 ? 'Found, length: ' + res.length : res);
