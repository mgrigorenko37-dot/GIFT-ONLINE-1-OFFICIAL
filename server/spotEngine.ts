import { Pool, PoolClient } from 'pg';

export interface Order {
  id?: string;
  user_id: string;
  asset_id: string;
  type: 'LIMIT' | 'MARKET';
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  filled_amount?: number;
  status?: 'OPEN' | 'FILLED' | 'PARTIAL' | 'CANCELLED';
}

import { getPostgresConfig } from './dbConfig';
const conf = getPostgresConfig();
const pool = new Pool(conf.config || { connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });

// 1. Structure of Database
export const DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
    id VARCHAR(50) PRIMARY KEY,
    symbol VARCHAR(50) UNIQUE NOT NULL,
    decimals INT DEFAULT 8,
    total_supply NUMERIC,
    last_price NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_balances (
    user_id VARCHAR(50) NOT NULL,
    asset_id VARCHAR(50) NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    locked_amount NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, asset_id)
);

CREATE TABLE IF NOT EXISTS order_book (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(50) NOT NULL,
    asset_id VARCHAR(50) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('LIMIT', 'MARKET')),
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price NUMERIC NOT NULL,
    amount NUMERIC NOT NULL,
    filled_amount NUMERIC NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_book_match ON order_book(asset_id, side, status, price);
CREATE INDEX IF NOT EXISTS idx_order_book_time ON order_book(created_at);

CREATE TABLE IF NOT EXISTS trades_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maker_order_id UUID NOT NULL,
    taker_order_id UUID NOT NULL,
    asset_id VARCHAR(50) NOT NULL,
    price NUMERIC NOT NULL,
    amount NUMERIC NOT NULL,
    maker_fee NUMERIC NOT NULL,
    taker_fee NUMERIC NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);
`;

// 2. Matching Engine Core
export async function matchOrder(newOrder: Order) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert the new order (if it's a LIMIT order, we store it. If MARKET, we might only store it temporarily or not store it until it's partially filled. But let's store it to have an ID).
    const insertRes = await client.query(
      `
      INSERT INTO order_book (user_id, asset_id, type, side, price, amount, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
      RETURNING id, price, amount, filled_amount
    `,
      [
        newOrder.user_id,
        newOrder.asset_id,
        newOrder.type,
        newOrder.side,
        newOrder.type === 'MARKET' ? 0 : newOrder.price,
        newOrder.amount,
      ]
    );

    const takerOrder = insertRes.rows[0];
    let remainingAmount = Number(newOrder.amount);

    // Lock the asset row to prevent concurrent matchings for the same asset?
    // Or we rely on SELECT FOR UPDATE on the order_book.

    // Find matching orders
    // If BUY, we look for SELL orders ordered by price ASC, created_at ASC
    // If SELL, we look for BUY orders ordered by price DESC, created_at ASC

    const operator = newOrder.side === 'BUY' ? '<=' : '>=';
    const sortOrder = newOrder.side === 'BUY' ? 'ASC' : 'DESC';
    const oppositeSide = newOrder.side === 'BUY' ? 'SELL' : 'BUY';

    // Fetch matching orders with Row-level lock (FOR UPDATE)
    const limitCondition = newOrder.type === 'LIMIT' ? `AND price ${operator} $3` : '';
    const matchingQuery = `
      SELECT id, user_id, price, amount, filled_amount, status 
      FROM order_book
      WHERE asset_id = $1 AND side = $2 AND status IN ('OPEN', 'PARTIAL')
      ${limitCondition}
      ORDER BY price ${sortOrder}, created_at ASC
      FOR UPDATE
    `;

    const queryParams =
      newOrder.type === 'LIMIT'
        ? [newOrder.asset_id, oppositeSide, newOrder.price]
        : [newOrder.asset_id, oppositeSide];

    const { rows: makerOrders } = await client.query(matchingQuery, queryParams);

    let takerFilled = 0;
    let levelPrice = 0;
    let levelDepleted = false;

    for (const maker of makerOrders) {
      if (remainingAmount <= 0) break;

      const makerPrice = Number(maker.price);
      const makerRemaining = Number(maker.amount) - Number(maker.filled_amount);
      const matchAmount = Math.min(remainingAmount, makerRemaining);

      const isLevelDepleted = matchAmount === makerRemaining;

      // Fees calculation
      // Taker pays 0.2%, Maker pays 0.1%
      const takerFee = matchAmount * makerPrice * 0.002;
      const makerFee = matchAmount * makerPrice * 0.001;

      // Update Maker Order
      const newMakerFilled = Number(maker.filled_amount) + matchAmount;
      const makerStatus = newMakerFilled >= Number(maker.amount) ? 'FILLED' : 'PARTIAL';

      await client.query(
        `
        UPDATE order_book SET filled_amount = $1, status = $2 WHERE id = $3
      `,
        [newMakerFilled, makerStatus, maker.id]
      );

      // Record Trade
      await client.query(
        `
        INSERT INTO trades_history (maker_order_id, taker_order_id, asset_id, price, amount, maker_fee, taker_fee)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
        [maker.id, takerOrder.id, newOrder.asset_id, makerPrice, matchAmount, makerFee, takerFee]
      );

      // Atomic Balance Updates
      // Example for BUY (Taker buys asset, pays quote currency e.g. USDT)
      // USDT is assumed to be asset_id = 'USDT'

      const quoteCurrency = 'USDT';
      const baseAsset = newOrder.asset_id;

      if (newOrder.side === 'BUY') {
        // Taker gets Base Asset (minus fee? Or fee is in quote?)
        // Standard: taker fee is taken from the receiving asset. But let's assume fee in Quote for simplicity, or Base.
        // If they want standard: buy fee in base, sell fee in quote.
        await updateBalance(client, newOrder.user_id, baseAsset, matchAmount * 0.998); // -0.2% fee
        await updateBalance(client, maker.user_id, quoteCurrency, matchAmount * makerPrice * 0.999); // -0.1% fee
        // The locked balances also need to be decremented (not fully implemented in this snippet to keep it concise).
      } else {
        // SELL
        await updateBalance(
          client,
          newOrder.user_id,
          quoteCurrency,
          matchAmount * makerPrice * 0.998
        ); // -0.2% fee
        await updateBalance(client, maker.user_id, baseAsset, matchAmount * 0.999); // -0.1% fee
      }

      takerFilled += matchAmount;
      remainingAmount -= matchAmount;
      levelPrice = makerPrice;

      if (isLevelDepleted) {
        levelDepleted = true;
      } else {
        levelDepleted = false;
      }
    }

    // Update Taker Order
    const takerStatus = remainingAmount <= 0 ? 'FILLED' : takerFilled > 0 ? 'PARTIAL' : 'OPEN';
    await client.query(
      `
      UPDATE order_book SET filled_amount = $1, status = $2 WHERE id = $3
    `,
      [takerFilled, takerStatus, takerOrder.id]
    );

    // Update Last Price based on specific logic (only if the level was completely depleted)
    if (levelDepleted && takerFilled > 0) {
      await client.query(
        `
        UPDATE assets SET last_price = $1 WHERE id = $2
      `,
        [levelPrice, newOrder.asset_id]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateBalance(
  client: PoolClient,
  userId: string,
  assetId: string,
  amountChange: number
) {
  // Simple UPSERT for balance
  await client.query(
    `
    INSERT INTO user_balances (user_id, asset_id, amount)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, asset_id) 
    DO UPDATE SET amount = user_balances.amount + $3
  `,
    [userId, assetId, amountChange]
  );
}
