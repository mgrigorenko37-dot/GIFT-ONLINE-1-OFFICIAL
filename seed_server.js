const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const newSeed = `
import { gifts } from './src/data/gifts';

const seededGifts = new Set();
const seedGift = (giftName: string, floor: number) => {
  if (seededGifts.has(giftName)) return;
  seededGifts.add(giftName);
  
  let basePrice = floor || 120;
  for (let i = 0; i < 15; i++) {
    orders.push({
      id: Math.random().toString(36).substr(2, 9),
      userId: 'system',
      giftName,
      side: 'sell',
      type: 'limit',
      price: parseFloat((basePrice + i * 0.5 + Math.random() * 0.5).toFixed(2)),
      amount: Math.floor(Math.random() * 50) + 1,
      filled: 0,
      status: 'open',
      time: Date.now(),
    });
    orders.push({
      id: Math.random().toString(36).substr(2, 9),
      userId: 'system',
      giftName,
      side: 'buy',
      type: 'limit',
      price: parseFloat((basePrice - i * 0.5 - Math.random() * 0.5).toFixed(2)),
      amount: Math.floor(Math.random() * 50) + 1,
      filled: 0,
      status: 'open',
      time: Date.now(),
    });
  }
};

const seedData = () => {
  gifts.forEach(g => seedGift(g.id, g.floor));
};
`;

code = code.replace(
  /\/\/ Seed some initial order book data[\s\S]*?seedData\(\);/,
  newSeed + "\nseedData();"
);

// We should also hook subscribe to seed dynamically just in case it's a telegram gift not in hardcoded
code = code.replace(
  "socket.on('subscribe', (giftName) => {",
  "socket.on('subscribe', (giftName) => {\n      seedGift(giftName, 100); // Seed if not already seeded"
);

fs.writeFileSync('server.ts', code);
