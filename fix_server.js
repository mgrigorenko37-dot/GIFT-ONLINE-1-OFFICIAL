const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace(/const fs = require\('fs'\); fs\.writeFileSync\('api_gifts_error\.log', String\(error\) \+ '\n' \+ error\.stack\); console\.error\('Error fetching gifts:', error\);/g, "console.error('Error fetching gifts:', error);");
fs.writeFileSync('server.ts', code, 'utf8');
