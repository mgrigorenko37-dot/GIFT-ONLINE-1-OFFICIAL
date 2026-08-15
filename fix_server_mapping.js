const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const importStatement = "import { mapTelegramGift } from './src/utils/giftMapper';";
if (!code.includes('mapTelegramGift')) {
  code = code.replace(
    "import { gifts as hardcodedGifts } from './src/data/gifts';",
    "import { gifts as hardcodedGifts } from './src/data/gifts';\n" + importStatement
  );
}

const oldMapLogic = `        const mappedGifts = data.result.gifts
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
          });`;

const newMapLogic = `        const mappedGifts = data.result.gifts
          .filter((g: any) => g.total_count !== undefined)
          .map(mapTelegramGift);`;

if (code.includes(oldMapLogic)) {
  code = code.replace(oldMapLogic, newMapLogic);
  fs.writeFileSync('server.ts', code);
  console.log('Replaced mapping logic in server.ts');
} else {
  console.log('Could not find old mapping logic in server.ts');
}
