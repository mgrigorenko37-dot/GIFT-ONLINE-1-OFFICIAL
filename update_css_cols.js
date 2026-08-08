const fs = require('fs');
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

// Media queries
css = css.replace(
  /\.gx-terminal-grid \{\n\s+grid-template-columns: 224px minmax\(330px, 1fr\) 265px;\n\s+\}/,
  `.gx-terminal-grid {
    grid-template-columns: minmax(330px, 1fr) 280px 300px;
  }
  .gx-far-left-column {
    display: none;
  }`
);

css = css.replace(
  /\.gx-terminal-grid \{\n\s+grid-template-columns: 215px minmax\(300px, 1fr\);\n\s+\}/,
  `.gx-terminal-grid {
    grid-template-columns: minmax(300px, 1fr) 280px;
  }
  .gx-far-left-column {
    display: none;
  }`
);

css = css.replace(
  /\.gx-left-column,\n\s+\.gx-markets-panel,\n\s+\.gx-center-column,\n\s+\.gx-right-column \{\n\s+width: 100%;\n\s+\}/g,
  `.gx-far-left-column,
  .gx-left-column,
  .gx-markets-panel,
  .gx-center-column,
  .gx-right-column {
    width: 100%;
  }`
);

fs.writeFileSync('src/styles/site.css', css);
