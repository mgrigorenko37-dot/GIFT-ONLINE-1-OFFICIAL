const { initMarketStateRepository, getMarketRepository } = require('./dist/server.cjs');
initMarketStateRepository(true).then(async () => {
  const repo = getMarketRepository();
  const res = await repo.getCandles('plush-pepe:classic:default:TON', '15m', { limit: 10 });
  console.log('Result:', res);
  process.exit(0);
});
