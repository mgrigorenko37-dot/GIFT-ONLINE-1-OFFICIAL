const { Pool } = require('pg');
const { PostgresTradingEngine } = require('./dist/server/trading/tradingEngine.js');

(async () => {
  const pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
  const engine = new PostgresTradingEngine(pool);
  const trade = await engine.executeTrade(null, {
    buyerOrderId: 'some_id',
    sellerOrderId: 'some_id',
    qty: 1, price: 10, executionId: 'temp_exec'
  }).catch(e => console.log(e));
  console.log(trade);
  process.exit(0);
})();
