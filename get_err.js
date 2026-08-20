const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace(
  /res\.status\(500\)\.json\(\{ error: 'Failed to fetch gifts' \}\);/g,
  "res.status(500).json({ error: String(error) + '\\n' + error.stack });"
);
fs.writeFileSync('server.ts', code, 'utf8');
