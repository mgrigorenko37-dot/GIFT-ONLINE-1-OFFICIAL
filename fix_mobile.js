const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(
  /\.gx-markets-panel,\n\s+\.gx-center-column,\n\s+\.gx-right-column \{\n\s+width: 100%;\n\s+\}/,
  '.gx-left-column,\\n  .gx-markets-panel,\\n  .gx-center-column,\\n  .gx-right-column {\\n    width: 100%;\\n  }'
);

css = css.replace(
  /\.gx-center-column \{\n\s+order: 1;\n\s+\}/,
  '.gx-left-column {\\n    order: 1;\\n  }\\n  .gx-center-column {\\n    order: 2;\\n  }'
);

css = css.replace(
  /\.gx-markets-panel \{\n\s+order: 2;\n\s+\}/,
  '.gx-markets-panel {\\n    order: 4;\\n  }'
);

// We need to disable overflow: hidden on mobile so it can scroll
css = css.replace(
  /@media \(max-width: 720px\) \{/,
  '@media (max-width: 720px) {\\n  .gx-app {\\n    height: auto;\\n    overflow: visible;\\n  }\\n  .gx-main {\\n    overflow: visible;\\n  }\\n'
);

// Restore chart height on mobile
css = css.replace(
  /\.gx-chart-panel \{\n\s+min-height: 400px;\n\s+\}/,
  '.gx-chart-panel {\\n    min-height: 400px;\\n    flex: none;\\n  }'
);

fs.writeFileSync('src/styles/site.css', css);
