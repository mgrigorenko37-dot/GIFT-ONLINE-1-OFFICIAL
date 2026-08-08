export type Gift = {
  id: string;
  name: string;
  collection: string;
  rarity: string;
  floor: number;
  change: number;
  volume: string;
  className: string;
  emoji?: string;
};

export const gifts: Gift[] = [
  { id: 'toy-poodle', name: 'Toy Poodle', collection: 'Telegram Gifts', rarity: 'Rare', floor: 40, change: 0.5, volume: '50K', className: 'gift-poodle', emoji: '🐩' },
  { id: 'white-rose', name: 'White Rose', collection: 'Telegram Gifts', rarity: 'Common', floor: 6, change: -0.2, volume: '100K', className: 'gift-white-rose', emoji: '💮' },
  { id: 'vintage-cigar', name: 'Vintage Cigar', collection: 'Telegram Gifts', rarity: 'Epic', floor: 85, change: 2.5, volume: '15K', className: 'gift-cigar', emoji: '🚬' },
  { id: 'golden-key', name: 'Golden Key', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 350, change: 10, volume: '12K', className: 'gift-key', emoji: '🗝️' },
  { id: 'whale', name: 'Whale', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 900, change: 5, volume: '2K', className: 'gift-whale', emoji: '🐋' },
  { id: 'durov-cap', name: "Durov's Cap", collection: 'Telegram Gifts', rarity: 'Legendary', floor: 124.8, change: 8.42, volume: '182K', className: 'gift-cap' , emoji: '🧢' },
  { id: 'cherry-blossom', name: 'Cherry Blossom', collection: 'Telegram Gifts', rarity: 'Epic', floor: 45.5, change: 5.2, volume: '120K', className: 'gift-cherry' , emoji: '🌸' },
  { id: 'lollipop', name: 'Lollipop', collection: 'Telegram Gifts', rarity: 'Common', floor: 8.4, change: 0.5, volume: '110K', className: 'gift-lollipop' , emoji: '🍭' },
  { id: 'plush-pepe', name: 'Plush Pepe', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 550.0, change: 18.2, volume: '9K', className: 'gift-pepe' , emoji: '🐸' },
  { id: 'evil-eye', name: 'Evil Eye', collection: 'Telegram Gifts', rarity: 'Epic', floor: 75.0, change: -2.4, volume: '65K', className: 'gift-eye' , emoji: '🧿' },
  { id: 'blue-bird', name: 'Blue Bird', collection: 'Telegram Gifts', rarity: 'Rare', floor: 15.5, change: -1.2, volume: '45K', className: 'gift-bird' , emoji: '🐦' },
  { id: 'berry-box', name: 'Berry Box', collection: 'Telegram Gifts', rarity: 'Rare', floor: 86.2, change: 4.16, volume: '96K', className: 'gift-berry' , emoji: '🍓' },
  { id: 'desk-calendar', name: 'Desk Calendar', collection: 'Telegram Gifts', rarity: 'Common', floor: 5.5, change: -0.5, volume: '150K', className: 'gift-calendar' , emoji: '📅' },
  { id: 'jingle-bells', name: 'Jingle Bells', collection: 'Telegram Gifts', rarity: 'Common', floor: 7.0, change: 1.2, volume: '120K', className: 'gift-bells' , emoji: '🔔' },
  { id: 'red-envelope', name: 'Red Envelope', collection: 'Telegram Gifts', rarity: 'Rare', floor: 21.0, change: -5.4, volume: '60K', className: 'gift-envelope' , emoji: '🧧' },
  { id: 'diamond-ring', name: 'Diamond Ring', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 312.5, change: -2.08, volume: '74K', className: 'gift-ring' , emoji: '💎' },
  { id: 'spooky-pumpkin', name: 'Spooky Pumpkin', collection: 'Telegram Gifts', rarity: 'Epic', floor: 70.0, change: -12.0, volume: '22K', className: 'gift-pumpkin' , emoji: '🎃' },
  { id: 'ghost', name: 'Ghost', collection: 'Telegram Gifts', rarity: 'Epic', floor: 95.0, change: 5.5, volume: '18K', className: 'gift-ghost' , emoji: '👻' },
  { id: 'black-cat', name: 'Black Cat', collection: 'Telegram Gifts', rarity: 'Rare', floor: 45.0, change: -2.5, volume: '35K', className: 'gift-cat' , emoji: '🐈‍⬛' },
  { id: 'witch-hat', name: 'Witch Hat', collection: 'Telegram Gifts', rarity: 'Common', floor: 18.0, change: 1.8, volume: '75K', className: 'gift-witch-hat' , emoji: '🧙‍♀️' },
  { id: 'delicious-cake', name: 'Delicious Cake', collection: 'Telegram Gifts', rarity: 'Epic', floor: 45.0, change: 12.3, volume: '33K', className: 'gift-cake' , emoji: '🎂' },
  { id: 'magic-potion', name: 'Magic Potion', collection: 'Telegram Gifts', rarity: 'Epic', floor: 65.5, change: 3.2, volume: '22K', className: 'gift-potion' , emoji: '🧪' },
  { id: 'alien', name: 'Alien', collection: 'Telegram Gifts', rarity: 'Rare', floor: 110.0, change: 25.4, volume: '18K', className: 'gift-alien' , emoji: '👽' },
  { id: 'star', name: 'Star', collection: 'Telegram Gifts', rarity: 'Rare', floor: 95.0, change: -2.1, volume: '40K', className: 'gift-star' , emoji: '⭐' },
  { id: 'heart', name: 'Heart', collection: 'Telegram Gifts', rarity: 'Epic', floor: 150.0, change: 5.5, volume: '12K', className: 'gift-heart' , emoji: '❤️' },
  { id: 'signet', name: 'Signet Ring', collection: 'Telegram Gifts', rarity: 'Rare', floor: 58.9, change: 12.6, volume: '58K', className: 'gift-signet' , emoji: '💍' },
  { id: 'duck', name: 'Duck', collection: 'Telegram Gifts', rarity: 'Epic', floor: 75.0, change: 1.1, volume: '25K', className: 'gift-duck' , emoji: '🦆' },
  { id: 'panda', name: 'Panda', collection: 'Telegram Gifts', rarity: 'Rare', floor: 35.5, change: -8.2, volume: '55K', className: 'gift-panda' , emoji: '🐼' },
  { id: 'snowman', name: 'Snowman', collection: 'Telegram Gifts', rarity: 'Rare', floor: 42.0, change: 0.0, volume: '30K', className: 'gift-snowman' , emoji: '⛄' },
  { id: 'xmas-tree', name: 'Christmas Tree', collection: 'Telegram Gifts', rarity: 'Epic', floor: 88.5, change: 15.0, volume: '20K', className: 'gift-tree' , emoji: '🎄' },
  { id: 'champagne', name: 'New Year Champagne', collection: 'Telegram Gifts', rarity: 'Rare', floor: 55.0, change: -4.5, volume: '38K', className: 'gift-champagne' , emoji: '🍾' },
  { id: 'gingerbread', name: 'Gingerbread Man', collection: 'Telegram Gifts', rarity: 'Common', floor: 12.0, change: 2.1, volume: '85K', className: 'gift-gingerbread' , emoji: '🫚' },
  { id: 'snowflake', name: 'Crystal Snowflake', collection: 'Telegram Gifts', rarity: 'Epic', floor: 105.0, change: 8.8, volume: '15K', className: 'gift-snowflake' , emoji: '❄️' },
  { id: 'valentine-heart', name: 'Valentine Heart', collection: 'Telegram Gifts', rarity: 'Rare', floor: 48.0, change: -1.5, volume: '42K', className: 'gift-vheart' , emoji: '💝' },
  { id: 'kings-crown', name: "King's Crown", collection: 'Telegram Gifts', rarity: 'Legendary', floor: 850.0, change: 22.5, volume: '5K', className: 'gift-crown' , emoji: '👑' },
  { id: 'dragon', name: 'Dragon', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 1200.0, change: 45.0, volume: '3K', className: 'gift-dragon' , emoji: '🐉' },
  { id: 'magic-wand', name: 'Magic Wand', collection: 'Telegram Gifts', rarity: 'Rare', floor: 62.5, change: 4.4, volume: '28K', className: 'gift-wand' , emoji: '🪄' },
  { id: 'rose', name: 'Rose', collection: 'Telegram Gifts', rarity: 'Common', floor: 4.5, change: 0.2, volume: '210K', className: 'gift-rose' , emoji: '🌹' },
  { id: 'moon', name: 'Moon', collection: 'Telegram Gifts', rarity: 'Rare', floor: 32.0, change: -1.4, volume: '82K', className: 'gift-moon' , emoji: '🌙' },
  { id: 'golden-ring', name: 'Golden Ring', collection: 'Telegram Gifts', rarity: 'Legendary', floor: 420.0, change: 15.6, volume: '45K', className: 'gift-golden-ring' , emoji: '🪩' }
];

export const formatGX = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
