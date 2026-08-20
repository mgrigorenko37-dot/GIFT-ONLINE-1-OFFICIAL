const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const replacement = `    const mapped = result.rows.map(r => {
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
    });`;

code = code.replace(
  /    const mapped = result\.rows\.map\(r => \(\{[\s\S]*?source: 'postgres'\n    \}\)\);/,
  replacement
);
fs.writeFileSync('server.ts', code, 'utf8');
