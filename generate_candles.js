const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

const TIMEFRAMES = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];

// Volatility config
const VOLATILITY = {
  '1s': [0.0005, 0.002],
  '1m': [0.0005, 0.002],
  '5m': [0.0005, 0.002],
  '15m': [0.005, 0.02],
  '1h': [0.005, 0.02],
  '4h': [0.005, 0.02],
  '1d': [0.03, 0.08],
  '1w': [0.03, 0.08],
  '1M': [0.03, 0.08],
};

const TF_MS = {
  '1s': 1000,
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
  '1w': 604800000,
  '1M': 2592000000,
};

async function generateCandlesForAsset(client, asset) {
  const now = Date.now();

  for (const tf of TIMEFRAMES) {
    let numCandles = 0;
    if (tf === '1s')
      numCandles = 100; // drastically reduce to avoid OOM or timeout on 851 assets
    else if (tf === '1m') numCandles = 24 * 6;
    else if (tf === '5m') numCandles = 24 * 3;
    else if (tf === '15m') numCandles = 24;
    else numCandles = Math.floor((30 * 24 * 60 * 60 * 1000) / TF_MS[tf]);

    if (tf === '1w') numCandles = 4;
    if (tf === '1M') numCandles = 1;
    if (numCandles <= 0) continue;

    let currentPrice = Number(asset.current_price_gx) || 1;
    let startTime = now - numCandles * TF_MS[tf];

    let values = [];
    let queryArgs = [];
    let paramCounter = 1;

    for (let i = 0; i < numCandles; i++) {
      const volRange = VOLATILITY[tf];
      const vol = volRange[0] + Math.random() * (volRange[1] - volRange[0]);

      const change = currentPrice * vol;
      const open = currentPrice;
      const close = currentPrice + (Math.random() > 0.5 ? change : -change);
      const high = Math.max(open, close) + Math.random() * change;
      const low = Math.min(open, close) - Math.random() * change;
      const volume = Math.random() * 10000 + 100;

      const sTime = startTime + i * TF_MS[tf];
      const eTime = sTime + TF_MS[tf] - 1;

      values.push(
        `($${paramCounter++}, $${paramCounter++}, $${paramCounter++}, $${paramCounter++}, $${paramCounter++}, $${paramCounter++}, $${paramCounter++}, $${paramCounter++}, $${paramCounter++}, 0, 0, 0, 0, 0, '', '', true, 1, $${paramCounter++})`
      );
      queryArgs.push(asset.id, tf, sTime, eTime, open, high, low, close, volume, now);

      currentPrice = close;

      if (values.length >= 1000 || i === numCandles - 1) {
        await client.query(
          `
          INSERT INTO candles (instrument_key, timeframe, start_time, end_time, open, high, low, close, volume, quote_volume, sum_quote, sum_quantity, item_count, trade_count, first_sale_id, last_sale_id, confirmed, revision, updated_at)
          VALUES ${values.join(',')}
          ON CONFLICT (instrument_key, timeframe, start_time) DO NOTHING
        `,
          queryArgs
        );
        values = [];
        queryArgs = [];
        paramCounter = 1;
      }
    }
  }
}

async function run() {
  const client = await pool.connect();
  try {
    const { rows: assets } = await client.query(
      "SELECT id, current_price_gx FROM gift_variants WHERE id LIKE '%_CLASSIC%' OR id LIKE '%_GOLD%' OR id LIKE '%_NEON%' OR id LIKE '%_CYBER%' OR id LIKE '%_DIAMOND%'"
    );

    console.log(`Generating candles for ${assets.length} assets...`);
    for (let i = 0; i < assets.length; i++) {
      await generateCandlesForAsset(client, assets[i]);
      if (i % 50 === 0) console.log(`Processed ${i} assets...`);
    }
    console.log('Candles generation completed!');
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

run();
