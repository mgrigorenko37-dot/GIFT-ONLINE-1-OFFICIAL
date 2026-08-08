const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// I will just override the API endpoint to merge telegram gifts if available with the hardcoded list
const replacement = `
import { gifts as hardcodedGifts } from './src/data/gifts';

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
          .filter((g: any) => g.total_count !== undefined)
          .map((g: any) => {
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
          
        // Merge with our hardcoded historical list so they show up everywhere
        const mergedIds = new Set(mappedGifts.map((g: any) => g.id));
        const finalGifts = [...mappedGifts, ...hardcodedGifts.filter(g => !mergedIds.has(g.id))];
        return res.json(finalGifts);
      }
    }
    
    // Fallback if no token or API fails (using hardcoded list logic)
    res.json(hardcodedGifts); 
  } catch (error) {
    console.error('Error fetching gifts:', error);
    res.status(500).json({ error: 'Failed to fetch gifts' });
  }
});
`;

code = code.replace(/\/\/ GIFTS API[\s\S]*?\}\);\n/, replacement);
fs.writeFileSync('server.ts', code);
