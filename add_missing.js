const fs = require('fs');

const missing = [
  { id: 'toy-poodle', name: 'Toy Poodle', collection: 'Telegram Gifts', rarity: 'Rare', floor: 40.0, change: 0.5, volume: '50K', className: 'gift-poodle', emoji: '🐩' },
  { id: 'white-rose', name: 'White Rose', collection: 'Telegram Gifts', rarity: 'Common', floor: 6.0, change: -0.2, volume: '100K', className: 'gift-white-rose', emoji: '💮' },
  { id: 'vintage-cigar', name: 'Vintage Cigar', collection: 'Telegram Gifts', rarity: 'Epic', floor: 85.0, change: 2.5, volume: '15K', className: 'gift-cigar', emoji: '🚬' },
  { id: 'golden-key', name: 'Golden Key', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 350.0, change: 10.0, volume: '12K', className: 'gift-key', emoji: '🗝️' },
  { id: 'whale', name: 'Whale', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 900.0, change: 5.0, volume: '2K', className: 'gift-whale', emoji: '🐋' }
];

let code = fs.readFileSync('src/data/gifts.ts', 'utf8');

const insertStr = missing.map(m => `  { id: '${m.id}', name: '${m.name}', collection: '${m.collection}', rarity: '${m.rarity}', floor: ${m.floor}, change: ${m.change}, volume: '${m.volume}', className: '${m.className}', emoji: '${m.emoji}' }`).join(',\n') + ',\n';

code = code.replace('export const gifts: Gift[] = [\n', 'export const gifts: Gift[] = [\n' + insertStr);

fs.writeFileSync('src/data/gifts.ts', code);
console.log("Added missing gifts");
