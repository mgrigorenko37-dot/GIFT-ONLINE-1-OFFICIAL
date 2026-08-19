const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace(/app\.get\('\/api\/testdb', async \(req,res\) => \{[\s\S]*?\}\);/g, "");
fs.writeFileSync('server.ts', code, 'utf8');
