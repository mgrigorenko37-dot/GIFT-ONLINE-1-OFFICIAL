const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css += `
  .gx-sidebar {
    display: none !important;
  }
`;
fs.writeFileSync('src/styles/site.css', css);
