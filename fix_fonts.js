const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

if (!html.includes('JetBrains+Mono')) {
  html = html.replace(
    '</head>',
    `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  </head>`
  );
  fs.writeFileSync('index.html', html);
}
