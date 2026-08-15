process.env.RUN_MIGRATIONS = 'true'; // Allow automatic DDL in AI Studio preview
import { simulateSales } from './server/mockMinter';
import {
  getHistory,
  processSale,
  initMarketStateRepository,
  getMarketRepository,
} from './server/marketState';
import { processTelegramMarketEvent } from './server/telegramAdapter';
import { handleGetCandles } from './server/candlesHandler';
import { attachSocketListeners, initRealtimeManager } from './server/realtimeManager';
import { getRedisHealthStatus, closeRedisConnections } from './server/redisManager';
import {
  getFloorPrice,
  addListing,
  updateListingPrice,
  cancelListing,
  sellListing,
} from './server/floorManager';
import { getMarketStats } from './server/marketStats';
import { getIndicators } from './server/indicatorEngine';
import { initOutboxWorker, stopOutboxWorker } from './server/outboxWorker';
import {
  webhookRateLimiter,
  restApiRateLimiter,
  validateTelegramWebhookSecret,
  requestTimeoutMiddleware,
} from './server/rateLimiter';

import { Pool } from 'pg';
export async function initDbSchema(pool: Pool) {
  let client;
  try {
    client = await pool.connect();
  } catch (err: any) {
    console.warn('[DB Setup] Could not connect to pool for DDL:', err?.message);
    return;
  }

  try {
    try {
      await client.query('SET search_path TO public');
    } catch (err) {}

    const tables = [
      `CREATE TABLE IF NOT EXISTS te_orders (
        order_id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
        order_type VARCHAR(20) NOT NULL,
        qty NUMERIC NOT NULL,
        price NUMERIC NOT NULL,
        reduce_only BOOLEAN NOT NULL DEFAULT false,
        position_effect VARCHAR(20),
        rejection_reason TEXT,
        status VARCHAR(20) NOT NULL,
        executed_qty NUMERIC NOT NULL DEFAULT 0,
        remaining_qty NUMERIC NOT NULL,
        avg_fill_price NUMERIC NOT NULL DEFAULT 0,
        fee NUMERIC NOT NULL DEFAULT 0,
        settlement_currency VARCHAR(32),
        fee_currency VARCHAR(32),
        pnl_currency VARCHAR(32),
        collateral_currency VARCHAR(32),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS te_executions (
        execution_id VARCHAR(255) PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
        requested_qty NUMERIC NOT NULL,
        fill_qty NUMERIC NOT NULL,
        fill_price NUMERIC NOT NULL,
        fee NUMERIC NOT NULL,
        status VARCHAR(20) NOT NULL,
        settlement_currency VARCHAR(32),
        fee_currency VARCHAR(32),
        pnl_currency VARCHAR(32),
        created_at BIGINT NOT NULL,
        processed_at BIGINT NOT NULL,
        source VARCHAR(50),
        external_execution_id VARCHAR(255)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS te_executions_source_ext_idx ON te_executions(source, external_execution_id) WHERE source IS NOT NULL AND external_execution_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS te_positions (
        position_id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
        qty NUMERIC NOT NULL,
        avg_entry_price NUMERIC NOT NULL,
        mark_price NUMERIC NOT NULL DEFAULT 0,
        unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
        realized_pnl NUMERIC NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL,
        settlement_currency VARCHAR(32),
        pnl_currency VARCHAR(32),
        collateral_currency VARCHAR(32),
        opened_at BIGINT DEFAULT 0,
        created_at BIGINT DEFAULT 0,
        updated_at BIGINT DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS te_balances (
        user_id VARCHAR(255),
        currency VARCHAR(20) DEFAULT 'TON',
        available_balance NUMERIC NOT NULL,
        locked_balance NUMERIC NOT NULL DEFAULT 0,
        realized_pnl NUMERIC NOT NULL DEFAULT 0,
        total_fees NUMERIC NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, currency)
      )`,
      `CREATE TABLE IF NOT EXISTS te_outbox_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        payload TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        currency VARCHAR(20),
        created_at BIGINT NOT NULL,
        published_at BIGINT
      )`,
      `CREATE TABLE IF NOT EXISTS te_funding_payments (
        funding_id VARCHAR(255) PRIMARY KEY,
        position_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        currency VARCHAR(32) NOT NULL,
        side VARCHAR(32) NOT NULL,
        funding_rate NUMERIC NOT NULL,
        funding_interval VARCHAR(32) NOT NULL DEFAULT '8h',
        funding_timestamp BIGINT NOT NULL,
        mark_price NUMERIC NOT NULL,
        qty NUMERIC NOT NULL,
        notional NUMERIC NOT NULL,
        funding_amount NUMERIC NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PROCESSED',
        created_at BIGINT NOT NULL,
        processed_at BIGINT NOT NULL,
        error_reason TEXT,
        CONSTRAINT te_funding_pos_ts_unique UNIQUE(position_id, instrument_key, currency, funding_interval, funding_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS te_funding_periods (
        instrument_key VARCHAR(255) NOT NULL,
        currency VARCHAR(32) NOT NULL,
        funding_interval VARCHAR(32) NOT NULL DEFAULT '8h',
        funding_timestamp BIGINT NOT NULL,
        funding_rate NUMERIC NOT NULL,
        mark_price NUMERIC NOT NULL,
        created_at BIGINT NOT NULL,
        CONSTRAINT te_funding_periods_pk PRIMARY KEY (instrument_key, currency, funding_interval, funding_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS te_position_snapshots (
        snapshot_id VARCHAR(255) PRIMARY KEY,
        position_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
        qty NUMERIC NOT NULL,
        avg_entry_price NUMERIC NOT NULL,
        status VARCHAR(20) NOT NULL,
        settlement_currency VARCHAR(32),
        collateral_currency VARCHAR(32),
        valid_from BIGINT NOT NULL,
        valid_to BIGINT,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS te_pos_snap_pos_time_idx ON te_position_snapshots(position_id, valid_from, valid_to)`,
    ];

    for (const sql of tables) {
      try {
        await client.query(sql);
      } catch (e: any) {
        console.warn('[DB Setup] Notice on CREATE TABLE:', e?.message);
      }
    }

    // Migration for te_funding_payments UNIQUE constraint (position_id, instrument_key, currency, funding_interval, funding_timestamp)
    try {
      const dupCheck = await client.query(`
        SELECT position_id, instrument_key, currency, funding_interval, funding_timestamp, COUNT(*)
        FROM te_funding_payments
        GROUP BY position_id, instrument_key, currency, funding_interval, funding_timestamp
        HAVING COUNT(*) > 1
      `);
      if (dupCheck.rows.length > 0) {
        console.error('[DB Setup] Migration warning: Duplicate te_funding_payments records detected! Unique constraint migration aborted to prevent silent deletion of financial records.');
      } else {
        await client.query('ALTER TABLE te_funding_payments DROP CONSTRAINT IF EXISTS te_funding_pos_ts_unique');
        await client.query('ALTER TABLE te_funding_payments ADD CONSTRAINT te_funding_pos_ts_unique UNIQUE(position_id, instrument_key, currency, funding_interval, funding_timestamp)');
      }
    } catch (e: any) {
      console.warn('[DB Setup] Notice on te_funding_payments constraint migration:', e?.message);
    }

    const alterQueries = [
      'ALTER TABLE te_orders ALTER COLUMN position_effect TYPE VARCHAR(32)',
      'ALTER TABLE te_balances ALTER COLUMN currency TYPE VARCHAR(32)',
      'ALTER TABLE te_orders ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_positions ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_trades ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_executions ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_outbox_events ALTER COLUMN event_type TYPE VARCHAR(100)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_orders ALTER COLUMN settlement_currency DROP NOT NULL',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',

      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_executions ALTER COLUMN settlement_currency DROP NOT NULL',
      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',

      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_positions ALTER COLUMN settlement_currency DROP NOT NULL',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS opened_at BIGINT DEFAULT 0',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS created_at BIGINT DEFAULT 0',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS updated_at BIGINT DEFAULT 0',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_timestamp BIGINT',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_reason TEXT',

      'ALTER TABLE te_outbox_events ADD COLUMN IF NOT EXISTS currency VARCHAR(32)',

      'GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC',
      'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC',
    ];

    for (const query of alterQueries) {
      try {
        await client.query(query);
      } catch (e: any) {
        console.warn('[DB Setup] Notice on ALTER query:', e?.message);
      }
    }
  } catch (err: any) {
    console.warn('[DB Setup] Error during schema init:', err?.message);
  } finally {
    client.release();
  }
}

async function setupDatabaseSchema() {
  if (!process.env.DATABASE_URL) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', (err) => {
    console.error('Setup DB Pool idle error:', err?.message);
  });
  try {
    await initDbSchema(pool);
    console.log(`[DB Setup] Ensured TE tables exist.`);
  } catch (err: any) {
    console.error('[DB Setup] Error setting up schema:', err?.message);
  } finally {
    await pool.end();
  }
}
setupDatabaseSchema().catch(console.error);

import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { createServer, Server as HttpServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(requestTimeoutMiddleware(30000));

// Apply REST API rate limiter globally to all /api/ endpoints (webhook routes override with specific webhook limiter)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/telegram/webhook') || req.path.startsWith('/sales/ingest')) {
    return next();
  }
  return restApiRateLimiter(req, res, next);
});

// External Telegram Sales Webhook / Ingestion API
app.post(
  '/api/telegram/webhook',
  webhookRateLimiter,
  validateTelegramWebhookSecret,
  (req: express.Request, res: express.Response) => {
    const result = processTelegramMarketEvent(req.body);
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  }
);

app.post(
  '/api/sales/ingest',
  webhookRateLimiter,
  validateTelegramWebhookSecret,
  (req: express.Request, res: express.Response) => {
    const result = processTelegramMarketEvent(req.body);
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  }
);

// API route to generate a Telegram Stars invoice link
app.get('/api/gifts', (req: express.Request, res: express.Response) => {
  res.json(gifts);
});

app.post('/api/create-invoice', async (req: express.Request, res: express.Response) => {
  const { title, description, payload, currency, prices } = req.body;
  const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return res.status(500).json({ error: 'BOT_TOKEN or TELEGRAM_BOT_TOKEN is not configured.' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        payload,
        provider_token: '', // Must be empty for Telegram Stars
        currency,
        prices,
      }),
    });
    const data = await response.json();
    if (data.ok) {
      res.json({ invoiceLink: data.result });
    } else {
      console.error('Telegram API Error:', data);
      res.status(400).json({ error: data.description || 'Failed to create invoice link.' });
    }
  } catch (error) {
    console.error('Error creating invoice link:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

import { PostgresTradingEngine, Order as EngineOrder } from './server/tradingEngine';
import { getPgPool } from './server/marketRepository';
import { startTradingOutboxWorker, stopTradingOutboxWorker } from './server/tradingOutboxWorker';

let tradingEngine: PostgresTradingEngine;
export const getTradingEngine = () => {
  if (!tradingEngine) tradingEngine = new PostgresTradingEngine(getPgPool());
  return tradingEngine;
};

// ORDER MATCHING ENGINE
type Order = {
  id: string;
  userId: string;
  giftName: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number;
  amount: number;
  filled: number;
  status: 'open' | 'filled' | 'cancelled';
  time: number;
};

type Trade = {
  id: string;
  giftName: string;
  price: number;
  amount: number;
  time: number;
  takerSide: 'buy' | 'sell';
};

const orders: Order[] = [];
const trades: Trade[] = [];
const balances: Record<string, number> = {};

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
  gifts.forEach((g) => seedGift(g.id, g.floor));
};

seedData();

const getOrderBook = (giftName: string) => {
  const activeOrders = orders.filter((o) => o.giftName === giftName && o.status === 'open');

  // Aggregate bids by price
  const bidsMap = new Map<number, number>();
  const asksMap = new Map<number, number>();

  activeOrders.forEach((o) => {
    const remaining = o.amount - o.filled;
    if (o.side === 'buy') {
      bidsMap.set(o.price, (bidsMap.get(o.price) || 0) + remaining);
    } else {
      asksMap.set(o.price, (asksMap.get(o.price) || 0) + remaining);
    }
  });

  const bids = Array.from(bidsMap.entries())
    .map(([price, amount]) => ({ price, amount }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 50);

  const asks = Array.from(asksMap.entries())
    .map(([price, amount]) => ({ price, amount }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 50);

  return { bids, asks };
};

const getTrades = (giftName: string) => {
  return trades
    .filter((t) => t.giftName === giftName)
    .sort((a, b) => b.time - a.time)
    .slice(0, 50);
};

const matchOrder = async (order: Order, io: Server, engineOrder?: any) => {
  const activeOrders = orders.filter(
    (o) => o.giftName === order.giftName && o.status === 'open' && o.side !== order.side
  );

  if (order.side === 'buy') {
    activeOrders.sort((a, b) => a.price - b.price || a.time - b.time); // Lowest ask first
  } else {
    activeOrders.sort((a, b) => b.price - a.price || a.time - b.time); // Highest bid first
  }

  let remainingToFill = order.amount - order.filled;
  for (const match of activeOrders) {
    if (remainingToFill <= 0) break;

    // Check limit price conditions
    if (order.type === 'limit') {
      if (order.side === 'buy' && order.price < match.price) break;
      if (order.side === 'sell' && order.price > match.price) break;
    }

    const available = match.amount - match.filled;
    const fillAmount = Math.min(remainingToFill, available);
    const fillPrice = match.price; // Taker gets the maker's price

    match.filled += fillAmount;
    order.filled += fillAmount;
    remainingToFill -= fillAmount;

    // Execute trade on both sides if they exist in trading engine
    if (engineOrder) {
      await getTradingEngine()
        .executeTrade(engineOrder.orderId, fillAmount, fillPrice)
        .catch(console.error);
    }
    // Try executing for maker as well
    await getTradingEngine().executeTrade(match.id, fillAmount, fillPrice).catch(console.error);

    await getTradingEngine().updateMarkPrice(order.giftName, fillPrice).catch(console.error);

    if (match.filled >= match.amount) match.status = 'filled';
    if (order.filled >= order.amount) order.status = 'filled';

    // Record trade
    const trade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      giftName: order.giftName,
      price: fillPrice,
      amount: fillAmount,
      time: Date.now(),
      takerSide: order.side,
    };
    trades.push(trade);

    io.to(order.giftName).emit('trade', trade);
  }

  // Update order book
  io.to(order.giftName).emit('orderBook', getOrderBook(order.giftName));
};

import { gifts as hardcodedGifts } from './src/data/gifts';
import { mapTelegramGift } from './src/utils/giftMapper';
import { normalizeInstrumentKey, Timeframe } from './src/types/market';

export interface GiftCollection {
  id: string;
  name: string;
  total_supply: number;
  image_url: string;
  floor_price_gx: number;
}

export interface GiftVariant {
  id: string;
  collection_id: string;
  model_name: string;
  backdrop_color: string;
  symbol_name: string;
  rarity_percentage: number;
  image_url: string;
  current_price_gx: number;
}

const dbCollections: GiftCollection[] = [];
const dbVariants: GiftVariant[] = [];

// Cron Job for syncing Telegram Gifts
const syncTelegramGifts = async () => {
  console.log('Starting Telegram Gifts Sync via TonAPI...');
  try {
    // 1. Fetch collections from TonAPI
    const res = await fetch('https://tonapi.io/v2/nfts/collections?limit=100');
    const data = await res.json();
    const tonCollections = data.nft_collections || [];

    // Process TonAPI collections (filter by telegram gifts if possible)
    const tgCollections = tonCollections.filter(
      (c: any) => c.name && c.name.toLowerCase().includes('gift')
    );

    for (const c of tgCollections) {
      if (!dbCollections.find((dbC) => dbC.id === c.address)) {
        dbCollections.push({
          id: c.address,
          name: c.name,
          total_supply: c.next_item_index || 10000,
          image_url: c.metadata?.image || '',
          floor_price_gx: 100,
        });
      }

      // Attempt to fetch items for this collection to parse traits
      try {
        const itemsRes = await fetch(
          `https://tonapi.io/v2/nfts/collections/${c.address}/items?limit=10`
        );
        const itemsData = await itemsRes.json();
        const items = itemsData.nft_items || [];

        items.forEach((item: any) => {
          const attributes = item.metadata?.attributes || [];
          const model = attributes.find((a: any) => a.trait_type === 'Model')?.value || 'Standard';
          const backdrop =
            attributes.find((a: any) => a.trait_type === 'Backdrop')?.value || '#2a2840';
          const symbol = attributes.find((a: any) => a.trait_type === 'Symbol')?.value || 'None';

          if (!dbVariants.find((v) => v.id === item.address)) {
            dbVariants.push({
              id: item.address,
              collection_id: c.address,
              model_name: model,
              backdrop_color: backdrop,
              symbol_name: symbol,
              rarity_percentage: 5.0,
              image_url: item.metadata?.image || '',
              current_price_gx: 120,
            });
          }
        });
      } catch (err) {
        console.error('Failed to fetch items for collection', c.address);
      }
    }

    // Ensure our hardcoded gifts are in the DB so the UI works
    for (const g of hardcodedGifts) {
      const existingCol = dbCollections.find((c) => c.id === g.id);
      if (!existingCol) {
        dbCollections.push({
          id: g.id,
          name: g.name,
          total_supply: parseInt((g.volume || '10').replace('K', '000')),
          image_url: '',
          floor_price_gx: g.floor,
        });
      } else {
        existingCol.floor_price_gx = g.floor;
      }

      // Generate some variants if not exist
      const backdrops = ['#ff0000', '#00ff00', '#0000ff', '#f0f0f0', '#2a2a2a'];
      const models = ['Standard', 'Holographic', 'Gold', 'Diamond'];

      for (let i = 0; i < 5; i++) {
        const variantId = `${g.id}-var-${i}`;
        const existingVar = dbVariants.find((v) => v.id === variantId);
        if (!existingVar) {
          dbVariants.push({
            id: variantId,
            collection_id: g.id,
            model_name: models[Math.floor(Math.random() * models.length)],
            backdrop_color: backdrops[Math.floor(Math.random() * backdrops.length)],
            symbol_name: 'Original',
            rarity_percentage: parseFloat((Math.random() * 100).toFixed(1)),
            image_url: '',
            current_price_gx: parseFloat((g.floor * (1 + Math.random())).toFixed(2)),
          });
        } else {
          // 4. Update floor prices
          existingVar.current_price_gx = parseFloat(
            (g.floor * (1 + Math.random() * 0.5)).toFixed(2)
          );
        }
      }
    }

    console.log(`Synced ${dbCollections.length} collections and ${dbVariants.length} variants.`);
  } catch (error) {
    console.error('Sync failed:', error);
  }
};

setInterval(syncTelegramGifts, 300000);
setTimeout(syncTelegramGifts, 1000);

// GIFTS API
app.get('/api/market/candles', handleGetCandles);

// Floor Price API
app.get('/api/market/floor', (req: express.Request, res: express.Response) => {
  const rawKey = (
    req.query.instrumentKey ||
    req.query.key ||
    req.query.collectionId ||
    ''
  ).toString();
  if (!rawKey || rawKey.trim() === '') {
    return res.status(400).json({ error: 'instrumentKey is required' });
  }

  const rawCurr = (req.query.currency || 'TON').toString();
  try {
    const floorResult = getFloorPrice(rawKey, rawCurr as any);
    return res.json({
      instrumentKey: floorResult.instrumentKey,
      currency: floorResult.currency,
      floorPrice: floorResult.floorPrice,
      listedCount: floorResult.listedCount,
      updatedAt: floorResult.updatedAt,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Invalid instrumentKey' });
  }
});

// Market Stats API
app.get('/api/market/stats', (req: express.Request, res: express.Response) => {
  const rawKey = (
    req.query.instrumentKey ||
    req.query.key ||
    req.query.collectionId ||
    ''
  ).toString();
  if (!rawKey || rawKey.trim() === '') {
    return res.status(400).json({ error: 'instrumentKey is required' });
  }

  const currency = (req.query.currency || 'TON').toString();
  const timeframe = req.query.timeframe ? req.query.timeframe.toString() : undefined;

  const fromNum = req.query.from !== undefined ? Number(req.query.from) : undefined;
  const toNum = req.query.to !== undefined ? Number(req.query.to) : undefined;

  const from = typeof fromNum === 'number' && !isNaN(fromNum) ? fromNum : undefined;
  const to = typeof toNum === 'number' && !isNaN(toNum) ? toNum : undefined;

  try {
    const stats = getMarketStats({
      instrumentKey: rawKey,
      currency: currency as any,
      timeframe,
      from,
      to,
    });
    return res.json(stats);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to compute market stats' });
  }
});

// Indicators API
app.get('/api/market/indicators', (req: express.Request, res: express.Response) => {
  const rawKey = (
    req.query.instrumentKey ||
    req.query.key ||
    req.query.collectionId ||
    ''
  ).toString();
  if (!rawKey || rawKey.trim() === '') {
    return res.status(400).json({ error: 'instrumentKey is required' });
  }

  const currency = (req.query.currency || 'TON').toString();
  const timeframe = (req.query.timeframe || '1m').toString() as any;
  const indicator = (req.query.indicator || 'sma').toString().toLowerCase() as any;
  const source = (req.query.source || 'close').toString().toLowerCase() as any;

  const period = req.query.period ? Number(req.query.period) : undefined;
  const fastPeriod = req.query.fastPeriod ? Number(req.query.fastPeriod) : undefined;
  const slowPeriod = req.query.slowPeriod ? Number(req.query.slowPeriod) : undefined;
  const signalPeriod = req.query.signalPeriod ? Number(req.query.signalPeriod) : undefined;

  const fromNum = req.query.from !== undefined ? Number(req.query.from) : undefined;
  const toNum = req.query.to !== undefined ? Number(req.query.to) : undefined;

  const from = typeof fromNum === 'number' && !isNaN(fromNum) ? fromNum : undefined;
  const to = typeof toNum === 'number' && !isNaN(toNum) ? toNum : undefined;

  try {
    const result = getIndicators({
      instrumentKey: rawKey,
      currency: currency as any,
      timeframe,
      indicator,
      source,
      period,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      from,
      to,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to compute indicators' });
  }
});

// Listing Management Endpoints
app.post('/api/market/listings', (req: express.Request, res: express.Response) => {
  const result = addListing(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(201).json(result);
});

app.patch('/api/market/listings/:id/price', (req: express.Request, res: express.Response) => {
  const { price } = req.body;
  const result = updateListingPrice(String(req.params.id), price);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result);
});

app.post('/api/market/listings/:id/cancel', (req: express.Request, res: express.Response) => {
  const result = cancelListing(String(req.params.id));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result);
});

app.post('/api/market/listings/:id/sell', (req: express.Request, res: express.Response) => {
  const result = sellListing(String(req.params.id));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result);
});

app.get('/api/collections', (req, res) => res.json(dbCollections));
app.get('/api/variants/:collection_id', (req, res) => {
  res.json(dbVariants.filter((v) => v.collection_id === req.params.collection_id));
});

app.get('/api/gifts', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const response = await fetch(`https://api.telegram.org/bot${token}/getAvailableGifts`);
      const data = await response.json();

      if (data.ok && data.result && data.result.gifts) {
        // Filter limited gifts and map to our schema
        const mappedGifts = data.result.gifts
          .filter((g: any) => g.total_count !== undefined)
          .map(mapTelegramGift);

        // Merge with our hardcoded historical list so they show up everywhere
        const mergedIds = new Set(mappedGifts.map((g: any) => g.id));
        const finalGifts = [...mappedGifts, ...hardcodedGifts.filter((g) => !mergedIds.has(g.id))];
        return res.json(finalGifts);
      }
    }

    // Fallback if no token or API fails (using hardcoded list logic)
    res.json(hardcodedGifts);
  } catch (error) {
    console.error('Error fetching gifts:', error);
    res.status(500).json({ error: 'Failed to fetch gifts' });
  }
});

// Production Deployment Probes: Health, Readiness, Liveness
app.get(['/health', '/api/health'], (req: express.Request, res: express.Response) => {
  const redisHealth = getRedisHealthStatus();
  const repo = getMarketRepository();
  const dbConnected = Boolean(process.env.SQL_HOST);

  res.status(200).json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    redis: redisHealth,
    database: {
      connected: dbConnected,
      repository: repo ? repo.constructor.name : 'Unknown',
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: PORT,
      requireRedis: process.env.REQUIRE_REDIS === 'true',
      simulationMode: process.env.SIMULATION_MODE === 'true',
      allowFileStorageInProd: process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true',
    },
  });
});

app.get(['/readiness', '/api/readiness'], (req: express.Request, res: express.Response) => {
  const requireRedis = process.env.REQUIRE_REDIS === 'true';
  const redisHealth = getRedisHealthStatus();
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDb = Boolean(process.env.SQL_HOST);
  const allowFileInProd = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true';

  if (requireRedis && !redisHealth.isConnected) {
    return res.status(503).json({
      ready: false,
      reason: 'Redis is required (REQUIRE_REDIS=true) but Redis connection is inactive.',
    });
  }

  if (isProduction && !hasDb) {
    return res.status(503).json({
      ready: false,
      reason: 'PostgreSQL (SQL_HOST) is strictly required in production.',
    });
  }

  return res.status(200).json({
    ready: true,
    timestamp: Date.now(),
    redisActive: redisHealth.isConnected,
  });
});

app.get(['/live', '/api/live'], (req: express.Request, res: express.Response) => {
  res.status(200).json({ alive: true, timestamp: Date.now() });
});

// Express error handling for Payload Too Large
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res
      .status(413)
      .json({ error: 'Payload Too Large: Maximum JSON payload size is 100kb.' });
  }
  next(err);
});

let httpServerRef: HttpServer | null = null;
let ioRef: Server | null = null;
let isShuttingDown = false;

export async function stopServerGracefully(signal = 'SIGTERM'): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Received ${signal}. Executing graceful shutdown sequence...`);

  try {
    stopOutboxWorker();
    stopTradingOutboxWorker();
    console.log('[Server] OutboxWorker stopped.');
  } catch (e) {
    console.error('[Server] Error stopping OutboxWorker:', e);
  }

  if (ioRef) {
    try {
      ioRef.close();
      console.log('[Server] Socket.io server closed.');
    } catch (e) {
      console.error('[Server] Error closing Socket.io:', e);
    }
  }

  if (httpServerRef) {
    await new Promise<void>((resolve) => {
      httpServerRef?.close(() => {
        console.log('[Server] HTTP listener stopped.');
        resolve();
      });
    });
  }

  try {
    await closeRedisConnections();
  } catch (e) {
    console.error('[Server] Error closing Redis connections:', e);
  }

  try {
    const repo = getMarketRepository() as any;
    if (repo && typeof repo.close === 'function') {
      await repo.close();
      console.log('[Server] Database pool closed.');
    }
  } catch (e) {
    console.error('[Server] Error closing database pool:', e);
  }

  console.log('[Server] Graceful shutdown completed.');
}

process.on('SIGTERM', () => {
  stopServerGracefully('SIGTERM').then(() => process.exit(0));
});

process.on('SIGINT', () => {
  stopServerGracefully('SIGINT').then(() => process.exit(0));
});

async function startServer() {
  initMarketStateRepository();
  initOutboxWorker(getMarketRepository());

  const httpServer = createServer(app);
  httpServerRef = httpServer;

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 10000,
  });
  ioRef = io;

  if (process.env.SQL_HOST) {
    startTradingOutboxWorker(getPgPool(), io);
  }

  // Subscribe to tradingEngine events and forward to connected clients
  getTradingEngine().on('tradeExecuted', (trade: any) => {
    io.to(trade.userId).emit('tradeExecuted', trade);
  });
  getTradingEngine().on('orderUpdated', (order: any) => {
    io.to(order.userId).emit('orderUpdated', order);
  });
  getTradingEngine().on('positionUpdated', (position: any) => {
    io.to(position.userId).emit('positionUpdated', position);
  });
  getTradingEngine().on('balanceUpdated', (data: any) => {
    io.to(data.userId).emit('balanceUpdated', data.balance);
  });
  getTradingEngine().on('historyUpdated', (data: any) => {
    io.to(data.userId).emit('historyUpdated', data.trade);
  });

  // Initialize Realtime Manager & Redis Pub/Sub Adapter
  initRealtimeManager(io);

  if (process.env.SIMULATION_MODE === 'true' || process.env.ENABLE_SIMULATION === 'true') {
    simulateSales(io);
  }
  io.on('connection', (socket) => {
    let currentRoom = '';

    attachSocketListeners(socket);

    socket.on('subscribe', async (giftName) => {
      seedGift(giftName, 100); // Seed if not already seeded
      if (currentRoom) socket.leave(currentRoom);
      socket.join(giftName);
      currentRoom = giftName;

      socket.emit('orderBook', getOrderBook(giftName));
      socket.emit('recentTrades', getTrades(giftName));
      // Send user's orders (mocking userId as socket.id for now)
      socket.emit(
        'userOrders',
        orders.filter((o) => o.userId === socket.id)
      );
      socket.emit('positions', await getTradingEngine().getAllPositions(socket.id));
      socket.emit('balance', await getTradingEngine().getBalance(socket.id));
      socket.emit('marginInfo', await getTradingEngine().getMarginInfo(socket.id, 'TON'));
      socket.emit('tradeHistory', await getTradingEngine().getUserTrades(socket.id));
    });

    socket.on('getMarginInfo', async (currency: string = 'TON') => {
      const margin = await getTradingEngine().getMarginInfo(socket.id, currency);
      socket.emit('marginInfo', margin);
    });

    socket.on('placeOrder', async (data) => {
      // 1. Use TradingEngine for positions and lifecycle
      const engineOrder = await getTradingEngine().placeOrder(
        {
          userId: socket.id,
          instrumentKey: data.giftName,
          side: data.side === 'buy' ? 'Buy' : 'Sell',
          orderType: data.type === 'limit' ? 'Limit' : 'Market',
          qty: Number(data.amount),
          price: Number(data.price) || 0,
          reduceOnly: data.reduceOnly === true,
        },
        true
      );

      if (engineOrder.status === 'Rejected') {
        socket.emit('orderRejected', engineOrder);
        return;
      }

      // Also create old order for orderbook
      const order: Order = {
        id: engineOrder.orderId,
        userId: socket.id,
        giftName: data.giftName,
        side: data.side,
        type: data.type,
        price: Number(data.price),
        amount: Number(data.amount),
        filled: 0,
        status: 'open',
        time: Date.now(),
      };
      orders.push(order);

      // We pass engineOrder to matchOrder to execute trades there
      await matchOrder(order, io, engineOrder);

      socket.emit(
        'userOrders',
        orders.filter((o) => o.userId === socket.id)
      );
      // No need to emit manually if engine handles it, but maybe just send positions anyway to be safe
      socket.emit('positions', await getTradingEngine().getAllPositions(socket.id));
      socket.emit('balance', await getTradingEngine().getBalance(socket.id));
      socket.emit('marginInfo', await getTradingEngine().getMarginInfo(socket.id, 'TON'));
    });

    socket.on('cancelOrder', async (orderId) => {
      // 1. Cancel in tradingEngine
      const engineOrder = await getTradingEngine().cancelOrder(orderId);

      const order = orders.find((o) => o.id === orderId && o.userId === socket.id);
      if (order && order.status === 'open') {
        order.status = 'cancelled';
        io.to(order.giftName).emit('orderBook', getOrderBook(order.giftName));
        socket.emit(
          'userOrders',
          orders.filter((o) => o.userId === socket.id)
        );
        socket.emit('balance', await getTradingEngine().getBalance(socket.id));
        socket.emit('positions', await getTradingEngine().getAllPositions(socket.id));
      }
    });
  });

  if (
    process.env.NO_VITE !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test'
  ) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}
