const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

if (!code.includes('import { getHistory } from "./server/marketState"')) {
  code = `import { getHistory, processSale } from "./server/marketState";\nimport { Timeframe } from "./server/chartEngine";\n` + code;
}

const apiRoutes = `// GIFTS API
app.get('/api/market/candles', (req, res) => {
  const { instrumentKey, timeframe, from, to, limit } = req.query;
  if (!instrumentKey || !timeframe) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  const fromTime = from ? parseInt(from) : 0;
  const toTime = to ? parseInt(to) : Date.now() + 86400000;
  const l = limit ? parseInt(limit) : 500;
  
  const candles = getHistory(instrumentKey, timeframe, fromTime, toTime, l);
  res.json({
    instrumentKey,
    timeframe,
    timezone: "UTC",
    candles,
    hasMore: candles.length === l,
    serverTime: Date.now()
  });
});
`;

if (!code.includes('/api/market/candles')) {
  code = code.replace('// GIFTS API', apiRoutes);
  fs.writeFileSync('server.ts', code);
}
console.log("Patched server.ts with /api/market/candles");
