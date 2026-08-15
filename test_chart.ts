import { getCandleRange } from './server/chartEngine';

console.log('1m', getCandleRange(1710000000000, '1m'));
console.log('1M', getCandleRange(1710000000000, '1M'));
