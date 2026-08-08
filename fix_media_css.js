const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(
  /\.gx-terminal-grid \{\n\s+grid-template-columns: 224px minmax\(330px, 1fr\) 265px;\n\s+\}/,
  `.gx-terminal-grid {
    grid-template-columns: minmax(330px, 1fr) 280px 300px;
  }
  .gx-left-column {
    display: none;
  }`
);

css = css.replace(
  /\.gx-terminal-grid \{\n\s+grid-template-columns: 215px minmax\(300px, 1fr\);\n\s+\}/,
  `.gx-terminal-grid {
    grid-template-columns: minmax(300px, 1fr) 280px;
  }
  .gx-left-column {
    display: none;
  }`
);

css = css.replace(
  /\.gx-right-column \{\n\s+grid-column: 1 \/ -1;\n\s+grid-template-columns: minmax\(250px, 1fr\) minmax\(280px, 1fr\);\n\s+\}/,
  `.gx-right-column {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: row;
  }`
);

fs.writeFileSync('src/styles/site.css', css);
