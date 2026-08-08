const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const apiEndpoint = `
// GIFTS API
app.get('/api/gifts', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const response = await fetch(\`https://api.telegram.org/bot\${token}/getAvailableGifts\`);
      const data = await response.json();
      
      if (data.ok && data.result && data.result.gifts) {
        // Filter limited gifts and map to our schema
        const mappedGifts = data.result.gifts
          .filter(g => g.total_count !== undefined)
          .map(g => {
             // Calculate rarity based on total_count as an example
             let rarity = 'Common';
             if (g.total_count <= 1000) rarity = 'Legendary';
             else if (g.total_count <= 10000) rarity = 'Epic';
             else if (g.total_count <= 50000) rarity = 'Rare';
             
             return {
               id: g.id,
               name: g.sticker?.emoji ? \`\${g.sticker.emoji} Gift\` : 'Gift',
               collection: 'Telegram Gifts',
               rarity,
               floor: g.star_count,
               change: parseFloat((Math.random() * 10 - 5).toFixed(2)),
               volume: \`\${Math.floor(Math.random() * 200)}K\`,
               className: 'gift-cap'
             };
          });
        return res.json(mappedGifts);
      }
    }
    
    // Fallback if no token or API fails (using hardcoded list logic)
    res.json([]); 
  } catch (error) {
    console.error('Error fetching gifts:', error);
    res.status(500).json({ error: 'Failed to fetch gifts' });
  }
});
`;

if (!code.includes('/api/gifts')) {
    code = code.replace('async function startServer() {', apiEndpoint + '\nasync function startServer() {');
    fs.writeFileSync('server.ts', code);
    console.log("Added /api/gifts");
} else {
    console.log("Already exists");
}
