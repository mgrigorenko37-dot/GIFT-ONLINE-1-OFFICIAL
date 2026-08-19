const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');
code = code.replace(/await client\.query\('ROLLBACK'\);/g, "try { await client.query('ROLLBACK'); } catch(e) {}");
code = code.replace(/await client\.query\('ROLLBACK TO SAVEPOINT (.*?)'\);/g, "try { await client.query('ROLLBACK TO SAVEPOINT $1'); } catch(e) {}");
fs.writeFileSync('server/tradingEngine.ts', code, 'utf8');
