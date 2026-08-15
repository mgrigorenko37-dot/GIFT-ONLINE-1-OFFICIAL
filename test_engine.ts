import { TradingEngine } from './src/engine/TradingEngine.js';

const engine = new TradingEngine();
engine.setBalance('u1', 10000);

const o1 = engine.placeOrder({
  userId: 'u1',
  instrumentKey: 'durov-cap',
  side: 'Buy',
  orderType: 'Market',
  qty: 10,
  price: 0,
  reduceOnly: false,
});
console.log('Balance before:', engine.getBalance('u1'));
engine.executeTrade(o1.orderId, 10, 100);
console.log('Balance after Buy:', engine.getBalance('u1'));

let pos = engine.getPosition('u1', 'durov-cap');
console.log('Position after Buy:', pos);

const o2 = engine.placeOrder({
  userId: 'u1',
  instrumentKey: 'durov-cap',
  side: 'Sell',
  orderType: 'Market',
  qty: 10,
  price: 0,
  reduceOnly: true,
});
engine.executeTrade(o2.orderId, 10, 150); // closed at profit
console.log('Balance after Sell (close Long at profit):', engine.getBalance('u1'));

pos = engine.getPosition('u1', 'durov-cap');
console.log('Position after Sell:', pos);
