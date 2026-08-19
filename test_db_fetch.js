const { PostgresMarketRepository } = require('./dist/server.cjs');
const repo = new PostgresMarketRepository();
repo.getCandles('plush-pepe:classic:default:TON', '15m', { limit: 10 }).then(res => {
  console.log(res);
});
