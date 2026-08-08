const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(
  /@media \(max-width: 720px\) \{\n\s+\.gx-app \{\n\s+height: auto;\n\s+overflow: visible;\n\s+\}\n\s+\.gx-main \{\n\s+overflow: visible;\n\s+\}/,
  `@media (max-width: 720px) {
  .gx-app {
    height: auto;
    overflow: visible;
  }
  .gx-main {
    overflow: visible;
  }
  .gx-left-column {
    display: flex;
  }`
);

fs.writeFileSync('src/styles/site.css', css);
