const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const apiCode = `
app.get('/api/gifts', async (req, res) => {
  try {
    const client = await getPgPool().connect();
    const result = await client.query('SELECT id, name, total_supply, image_url, floor_price_gx FROM gift_collections');
    client.release();
    
    const mapped = result.rows.map(r => {
      const fallback = hardcodedGifts.find(g => g.id === r.id);
      return {
        id: r.id,
        name: r.name,
        collection: 'Telegram Gifts',
        rarity: fallback ? fallback.rarity : 'Common',
        floor: Number(r.floor_price_gx) || (fallback ? fallback.floor : 0),
        change: fallback ? fallback.change : 0,
        volume: fallback ? fallback.volume : '0',
        className: fallback ? fallback.className : 'gx-gift-box',
        emoji: fallback ? fallback.emoji : undefined,
        image_url: r.image_url || (fallback ? fallback.image_url : undefined),
        is_nft: true,
        source: 'postgres'
      };
    });
    res.json(mapped);
  } catch (error) {
    console.error('Error fetching gifts:', error);
    res.status(500).json({ error: String(error) });
  }
});
`;

code = code.replace(
  '// --- Real-time Price Cache ---',
  apiCode + '\n// --- Real-time Price Cache ---'
);
fs.writeFileSync('server.ts', code, 'utf8');
