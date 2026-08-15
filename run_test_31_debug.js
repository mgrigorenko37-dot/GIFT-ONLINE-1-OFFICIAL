const { Pool } = require('pg');
const { PostgresTradingEngine } = require('./server/tradingEngine');

async function run() {
  const pool = new Pool({
    host: process.env.SQL_HOST || 'localhost',
    user: process.env.SQL_USER || 'ai_studio_app_user',
    password: process.env.SQL_PASSWORD || 'password',
    database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
  });
  const engine = new PostgresTradingEngine(pool);
  
  const positions = await engine.getAllPositions('liq_user_1');
  console.log('Positions:', positions);
  
  const trades = await engine.getUserTrades('liq_user_1');
  console.log('Trades:', trades);

  const margin = await engine.getMarginInfo('liq_user_1', 'TON');
  console.log('Margin Info:', margin);
  
  await pool.end();
}
run().catch(console.error);
