const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

function extractDiv(className) {
  const re = new RegExp('<(?:div|aside)[^>]*className=[\'"]' + className + '[\'"][^>]*>');
  const match = content.match(re);
  if (!match) return null;

  let start = match.index;
  let depth = 0;
  let i = start;
  while (i < content.length) {
    if (content.substr(i, 4) === '<div' || content.substr(i, 6) === '<aside') {
      let j = i + (content.substr(i, 4) === '<div' ? 4 : 6);
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
      i = j;
    } else if (content.substr(i, 5) === '</div') {
      depth--;
      if (depth === 0) {
        return content.substring(start, i + 6);
      }
    } else if (content.substr(i, 7) === '</aside') {
      depth--;
      if (depth === 0) {
        return content.substring(start, i + 8);
      }
    }
    i++;
  }
  return null;
}

const leftCol = extractDiv('gx-left-column');
const centerCol = extractDiv('gx-center-column');
const rightCol = extractDiv('gx-right-column');
const marketsPanel = extractDiv('gx-panel gx-markets-panel');
const orderPanel = extractDiv('gx-panel gx-order-panel');

console.log('Cols found:', !!leftCol, !!centerCol, !!rightCol, !!marketsPanel, !!orderPanel);

if (leftCol && centerCol && rightCol && marketsPanel && orderPanel) {
  const sectionStr = "<section className='gx-terminal gx-terminal-grid'>";
  const startIdx = content.indexOf(sectionStr);
  if (startIdx !== -1) {
    let before = content.substring(0, startIdx + sectionStr.length);
    let endIdx = content.indexOf('</section>', startIdx);
    let after = content.substring(endIdx);

    const newLayout = `
          <div className='gx-far-left-column'>
            ${marketsPanel}
          </div>
          ${leftCol}
          ${centerCol}
          <div className='gx-right-column'>
            ${orderPanel}
          </div>
`;
    content = before + newLayout + after;
    fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
    console.log('Layout updated successfully.');
  } else {
    console.log('Section not found!');
  }
} else {
  console.log('Missing panels, did not update layout.');
}
