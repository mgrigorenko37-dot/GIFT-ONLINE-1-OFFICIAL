const fs = require('fs');

const emojis = {
  "Durov's Cap": '🧢',
  'Red Kite': '🪁',
  'Cherry Blossom': '🌸',
  Lollipop: '🍭',
  'Toy Poodle': '🐩',
  'Magic Potion': '🧪',
  'White Rose': '💮',
  'Vintage Cigar': '🚬',
  'Golden Key': '🗝️',
  'Spooky Pumpkin': '🎃',
  Ghost: '👻',
  'Black Cat': '🐈‍⬛',
  'Witch Hat': '🧙‍♀️',
  'Delicious Cake': '🎂',
  Alien: '👽',
  Star: '⭐',
  Heart: '❤️',
  'Signet Ring': '💍',
  Duck: '🦆',
  Panda: '🐼',
  Snowman: '⛄',
  'Christmas Tree': '🎄',
  'New Year Champagne': '🍾',
  'Gingerbread Man': '🫚',
  'Crystal Snowflake': '❄️',
  'Valentine Heart': '💝',
  "King's Crown": '👑',
  Dragon: '🐉',
  'Magic Wand': '🪄',
  Rose: '🌹',
  Moon: '🌙',
  'Golden Ring': '🪩',
  'Berry Box': '🍓',
  'Desk Calendar': '📅',
  'Jingle Bells': '🔔',
  'Red Envelope': '🧧',
  'Diamond Ring': '💎',
  'Plush Pepe': '🐸',
  'Evil Eye': '🧿',
  'Blue Bird': '🐦',
  Whale: '🐋',
};

let code = fs.readFileSync('src/data/gifts.ts', 'utf8');

// Update Gift type to include emoji
if (!code.includes('emoji?: string')) {
  code = code.replace('className: string;', 'className: string;\n  emoji?: string;');
}

// Add emoji to each gift
for (const [name, emoji] of Object.entries(emojis)) {
  const regex = new RegExp(
    `(name:\\s*["']${name.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\$&')}["'][^\\}]*)(\\s*\\})`,
    'g'
  );
  code = code.replace(regex, `$1, emoji: '${emoji}' $2`);
}

fs.writeFileSync('src/data/gifts.ts', code);
console.log('Updated gifts.ts with emojis');
