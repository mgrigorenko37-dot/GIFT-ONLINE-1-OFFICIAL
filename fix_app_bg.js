const fs = require('fs');

let css = fs.readFileSync('src/styles/site.css', 'utf8');

css += `
/* Override main backgrounds for Bybit feel */
:root {
  --gx-bg: #101014;
  --gx-panel: #181a20;
  --gx-border: #2a2a30;
}

body {
  background: var(--gx-bg);
  color: #EAECEF;
}

.gx-panel {
  background: var(--gx-panel);
  border-color: var(--gx-border);
}
`;

fs.writeFileSync('src/styles/site.css', css);
