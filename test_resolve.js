const { resolveMarketRepository } = require('./dist/server.cjs');
console.log(resolveMarketRepository().constructor.name);
