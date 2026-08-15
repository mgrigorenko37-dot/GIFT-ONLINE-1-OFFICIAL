import fs from 'fs';
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');
code = code.replace(
  "if (process.env.INJECT_DELAY) { console.log('[TradingEngine] Delaying for 2000ms in PID ' + process.pid); await new Promise(r => setTimeout(r, 2000)); }\n        const fundingId = 'funding_' + crypto.randomUUID();",
  "const fundingId = 'funding_' + crypto.randomUUID();"
);
fs.writeFileSync('server/tradingEngine.ts', code);
