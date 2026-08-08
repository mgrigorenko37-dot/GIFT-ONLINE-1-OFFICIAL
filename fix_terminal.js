const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// Change grid template to 3 columns without the left markets panel
let css = fs.readFileSync('src/styles/site.css', 'utf8');
css = css.replace(
  /grid-template-columns: 255px minmax\(400px, 1fr\) 292px;/,
  'grid-template-columns: minmax(400px, 1fr) 280px 320px;'
);
fs.writeFileSync('src/styles/site.css', css);
