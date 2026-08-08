const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

// 1250px override
css = css.replace(
  /\.gx-terminal-grid \{\n\s+grid-template-columns: 224px minmax\(330px, 1fr\) 265px;\n\s+\}/,
  '.gx-terminal-grid {\\n    grid-template-columns: minmax(300px, 1fr) 250px 280px;\\n  }'
);

// 1020px override
css = css.replace(
  /\.gx-terminal-grid \{\n\s+grid-template-columns: 215px minmax\(300px, 1fr\);\n\s+\}/,
  '.gx-terminal-grid {\\n    grid-template-columns: minmax(300px, 1fr) 280px;\\n  }'
);
// In 1020px, gx-right-column goes to next row
css = css.replace(
  /\.gx-right-column \{\n\s+grid-column: 1 \/ -1;\n\s+grid-template-columns: minmax\(250px, 1fr\) minmax\(280px, 1fr\);\n\s+\}/,
  '.gx-right-column {\\n    grid-column: 1 / -1;\\n    flex-direction: row;\\n  }\\n  .gx-right-column > * {\\n    flex: 1;\\n  }'
);

// 720px override
// Let's check what 720px does
