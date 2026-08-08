const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(/\.layout\s*\{[\s\S]*?\}/g, '');
css = css.replace(/\.col\s*\{[\s\S]*?\}/g, '');

fs.writeFileSync('src/styles/site.css', css);
