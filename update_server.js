const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf8');

const rateEndpoint = `
// --- Real-time Price Cache ---
let cachedGramPrice = 5.50; // Fallback realistic price
let lastGramPriceFetch = 0;

app.get('/api/rates', async (req, res) => {
  const now = Date.now();
  // Update cache every 30 seconds
  if (now - lastGramPriceFetch > 30000) {
    try {
      // Fetching TON/USDT price from Binance public API
      const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT');
      if (response.ok) {
        const data = await response.json();
        if (data && data.price) {
          cachedGramPrice = parseFloat(data.price);
          lastGramPriceFetch = now;
        }
      }
    } catch (e) {
      console.error('Failed to fetch real-time Gram/TON rate:', e);
    }
  }
  res.json({ gram: cachedGramPrice });
});
`;

// Insert the rate endpoint before /api/config
if (!code.includes('/api/rates')) {
  code = code.replace("app.get('/api/config',", rateEndpoint + "\napp.get('/api/config',");
  fs.writeFileSync('server.ts', code);
  console.log('Added /api/rates to server.ts');
} else {
  console.log('/api/rates already exists');
}
