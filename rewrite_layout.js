const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');
const lines = content.split('\n');

const colLines = [];
lines.forEach((l, i) => {
  if (l.includes("className='gx-left-column'")) colLines.push({ col: 'left', line: i });
  if (l.includes("className='gx-center-column'")) colLines.push({ col: 'center', line: i });
  if (l.includes("className='gx-right-column'")) colLines.push({ col: 'right', line: i });
  if (l.includes("className='gx-panel "))
    colLines.push({ panel: l.match(/gx-[a-z-]+-panel/)[0], line: i });
});
console.log(colLines);
