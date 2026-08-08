const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(
  /@media \(max-width: 720px\) \{/,
  `@media (max-width: 720px) {
  .gx-far-left-column {
    display: flex;
  }`
);

fs.writeFileSync('src/styles/site.css', css);
