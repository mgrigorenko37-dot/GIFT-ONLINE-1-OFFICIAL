const fs = require('fs');
let code = fs.readFileSync('src/styles/site.css', 'utf8');
code = code.replace(
  /\.gx-market-browser \{\n  overflow: hidden;\n\}/g,
  '.gx-market-browser {\n  overflow: visible;\n}'
);
fs.writeFileSync('src/styles/site.css', code, 'utf8');
