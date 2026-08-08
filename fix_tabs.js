const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

content = content.replace(
  /<div className='gx-order-tabs' style={{ margin: 0 }}>/,
  "<div className='gx-activity-tabs'>"
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);

let css = fs.readFileSync('src/styles/site.css', 'utf8');

css += `
.gx-activity-tabs {
  display: flex;
  gap: 16px;
  border-bottom: 1px solid var(--gx-border);
  padding: 0 16px;
  width: 100%;
}

.gx-activity-tabs button {
  background: none;
  border: none;
  color: var(--gx-muted);
  font-size: 13px;
  font-weight: 500;
  padding: 12px 0;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.gx-activity-tabs button:hover {
  color: #fff;
}

.gx-activity-tabs button.is-active {
  color: #fff;
  border-bottom-color: var(--gx-accent);
}

.gx-orders-title {
  padding: 0 !important;
  border-bottom: none !important;
}
`;

fs.writeFileSync('src/styles/site.css', css);
