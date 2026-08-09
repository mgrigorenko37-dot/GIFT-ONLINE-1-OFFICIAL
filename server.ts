import { simulateSales } from "./server/mockMinter";
import { getHistory, processSale, initMarketStateRepository, getMarketRepository } from "./server/marketState";
import { processTelegramMarketEvent } from "./server/telegramAdapter";
import { handleGetCandles } from "./server/candlesHandler";
import { attachSocketListeners, initRealtimeManager } from "./server/realtimeManager";
import { getRedisHealthStatus, closeRedisConnections } from "./server/redisManager";
import { getFloorPrice, addListing, updateListingPrice, cancelListing, sellListing } from "./server/floorManager";
import { getMarketStats } from "./server/marketStats";
import { getIndicators } from "./server/indicatorEngine";
import { initOutboxWorker, stopOutboxWorker } from "./server/outboxWorker";
import {
  webhookRateLimiter,
  restApiRateLimiter,
  validateTelegramWebhookSecret,
  requestTimeoutMiddleware
} from "./server/rateLimiter";
import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { createServer, Server as HttpServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

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
app.post('/api/telegram/webhook', webhookRateLimiter, validateTelegramWebhookSecret, (req: express.Request, res: express.Response) => {
  const result = processTelegramMarketEvent(req.body);
  if (result.success) {
    return res.status(200).json(result);
  } else {
    return res.status(400).json(result);
  }
});

app.post('/api/sales/ingest', webhookRateLimiter, validateTelegramWebhookSecret, (req: express.Request, res: express.Response) => {
  const result = processTelegramMarketEvent(req.body);
  if (result.success) {
    return res.status(200).json(result);
  } else {
    return res.status(400).json(result);
  }
});

// API route to generate a Telegram Stars invoice link
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
  gifts.forEach(g => seedGift(g.id, g.floor));
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

const matchOrder = (order: Order, io: Server) => {
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

    // Update balances
    if (order.side === 'buy') {
      // order was a buy. If it was a market order, deduct now. If limit, it was already deducted on placeOrder (we'll assume at fillPrice for simplicity to avoid complex refunds for price differences)
      if (order.type === 'market') {
        balances[order.userId] = (balances[order.userId] || 12480.5) - fillAmount * fillPrice;
      }
      balances[match.userId] = (balances[match.userId] || 12480.5) + fillAmount * fillPrice;
    } else {
      // order was a sell.
      balances[order.userId] = (balances[order.userId] || 12480.5) + fillAmount * fillPrice;
      // match was a buy limit order, so it was already deducted.
    }

    // Update balances
    if (order.side === 'buy') {
      balances[order.userId] = (balances[order.userId] || 12480.5) - fillAmount * fillPrice;
      balances[match.userId] = (balances[match.userId] || 12480.5) + fillAmount * fillPrice;
    } else {
      balances[order.userId] = (balances[order.userId] || 12480.5) + fillAmount * fillPrice;
      balances[match.userId] = (balances[match.userId] || 12480.5) - fillAmount * fillPrice;
    }

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
  console.log("Starting Telegram Gifts Sync via TonAPI...");
  try {
    // 1. Fetch collections from TonAPI
    const res = await fetch("https://tonapi.io/v2/nfts/collections?limit=100");
    const data = await res.json();
    const tonCollections = data.nft_collections || [];
    
    // Process TonAPI collections (filter by telegram gifts if possible)
    const tgCollections = tonCollections.filter((c: any) => c.name && c.name.toLowerCase().includes('gift'));
    
    for (const c of tgCollections) {
      if (!dbCollections.find(dbC => dbC.id === c.address)) {
        dbCollections.push({
          id: c.address,
          name: c.name,
          total_supply: c.next_item_index || 10000,
          image_url: c.metadata?.image || '',
          floor_price_gx: 100
        });
      }
      
      // Attempt to fetch items for this collection to parse traits
      try {
        const itemsRes = await fetch(`https://tonapi.io/v2/nfts/collections/${c.address}/items?limit=10`);
        const itemsData = await itemsRes.json();
        const items = itemsData.nft_items || [];
        
        items.forEach((item: any) => {
          const attributes = item.metadata?.attributes || [];
          const model = attributes.find((a: any) => a.trait_type === 'Model')?.value || 'Standard';
          const backdrop = attributes.find((a: any) => a.trait_type === 'Backdrop')?.value || '#2a2840';
          const symbol = attributes.find((a: any) => a.trait_type === 'Symbol')?.value || 'None';
          
          if (!dbVariants.find(v => v.id === item.address)) {
            dbVariants.push({
              id: item.address,
              collection_id: c.address,
              model_name: model,
              backdrop_color: backdrop,
              symbol_name: symbol,
              rarity_percentage: 5.0,
              image_url: item.metadata?.image || '',
              current_price_gx: 120
            });
          }
        });
      } catch (err) {
        console.error("Failed to fetch items for collection", c.address);
      }
    }
    
    // Ensure our hardcoded gifts are in the DB so the UI works
    for (const g of hardcodedGifts) {
      const existingCol = dbCollections.find(c => c.id === g.id);
      if (!existingCol) {
        dbCollections.push({
          id: g.id,
          name: g.name,
          total_supply: parseInt((g.volume || '10').replace('K', '000')),
          image_url: '',
          floor_price_gx: g.floor
        });
      } else {
        existingCol.floor_price_gx = g.floor;
      }
      
      // Generate some variants if not exist
      const backdrops = ['#ff0000', '#00ff00', '#0000ff', '#f0f0f0', '#2a2a2a'];
      const models = ['Standard', 'Holographic', 'Gold', 'Diamond'];
      
      for(let i = 0; i < 5; i++) {
        const variantId = `${g.id}-var-${i}`;
        const existingVar = dbVariants.find(v => v.id === variantId);
        if (!existingVar) {
          dbVariants.push({
            id: variantId,
            collection_id: g.id,
            model_name: models[Math.floor(Math.random() * models.length)],
            backdrop_color: backdrops[Math.floor(Math.random() * backdrops.length)],
            symbol_name: 'Original',
            rarity_percentage: parseFloat((Math.random() * 100).toFixed(1)),
            image_url: '',
            current_price_gx: parseFloat((g.floor * (1 + Math.random())).toFixed(2))
          });
        } else {
          // 4. Update floor prices
          existingVar.current_price_gx = parseFloat((g.floor * (1 + (Math.random() * 0.5))).toFixed(2));
        }
      }
    }
    
    console.log(`Synced ${dbCollections.length} collections and ${dbVariants.length} variants.`);
  } catch (error) {
    console.error("Sync failed:", error);
  }
};

setInterval(syncTelegramGifts, 300000);
setTimeout(syncTelegramGifts, 1000);


// GIFTS API
app.get('/api/market/candles', handleGetCandles);

// Floor Price API
app.get('/api/market/floor', (req: express.Request, res: express.Response) => {
  const rawKey = (req.query.instrumentKey || req.query.key || req.query.collectionId || '').toString();
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
  const rawKey = (req.query.instrumentKey || req.query.key || req.query.collectionId || '').toString();
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
  const rawKey = (req.query.instrumentKey || req.query.key || req.query.collectionId || '').toString();
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
  res.json(dbVariants.filter(v => v.collection_id === req.params.collection_id));
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
        const finalGifts = [...mappedGifts, ...hardcodedGifts.filter(g => !mergedIds.has(g.id))];
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
  const dbConnected = Boolean(process.env.DATABASE_URL);

  res.status(200).json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    redis: redisHealth,
    database: {
      connected: dbConnected,
      repository: repo ? repo.constructor.name : 'Unknown'
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: PORT,
      requireRedis: process.env.REQUIRE_REDIS === 'true',
      simulationMode: process.env.SIMULATION_MODE === 'true',
      allowFileStorageInProd: process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true'
    }
  });
});

app.get(['/readiness', '/api/readiness'], (req: express.Request, res: express.Response) => {
  const requireRedis = process.env.REQUIRE_REDIS === 'true';
  const redisHealth = getRedisHealthStatus();
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDb = Boolean(process.env.DATABASE_URL);
  const allowFileInProd = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true';

  if (requireRedis && !redisHealth.isConnected) {
    return res.status(503).json({
      ready: false,
      reason: 'Redis is required (REQUIRE_REDIS=true) but Redis connection is inactive.'
    });
  }

  if (isProduction && !hasDb) {
    return res.status(503).json({
      ready: false,
      reason: 'PostgreSQL (DATABASE_URL) is strictly required in production.'
    });
  }

  return res.status(200).json({
    ready: true,
    timestamp: Date.now(),
    redisActive: redisHealth.isConnected
  });
});

app.get(['/live', '/api/live'], (req: express.Request, res: express.Response) => {
  res.status(200).json({ alive: true, timestamp: Date.now() });
});

// Express error handling for Payload Too Large
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'Payload Too Large: Maximum JSON payload size is 100kb.' });
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

  // Initialize Realtime Manager & Redis Pub/Sub Adapter
  initRealtimeManager(io);

  if (process.env.SIMULATION_MODE === 'true' || process.env.ENABLE_SIMULATION === 'true') {
    simulateSales(io);
  }
  io.on('connection', (socket) => {
    let currentRoom = '';

    attachSocketListeners(socket);

    socket.on('subscribe', (giftName) => {
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
    });

    socket.on('placeOrder', (data) => {
      const order: Order = {
        id: Math.random().toString(36).substr(2, 9),
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

      if (order.side === 'buy' && order.type === 'limit') {
        balances[socket.id] = (balances[socket.id] || 12480.5) - order.price * order.amount;
      }
      orders.push(order);
      matchOrder(order, io);

      socket.emit(
        'userOrders',
        orders.filter((o) => o.userId === socket.id)
      );
      socket.emit('orderPlaced', order);
      socket.emit('balance', balances[socket.id] || 12480.5);
    });

    socket.on('cancelOrder', (orderId) => {
      const order = orders.find((o) => o.id === orderId && o.userId === socket.id);
      if (order && order.status === 'open') {
        order.status = 'cancelled';
        if (order.side === 'buy' && order.type === 'limit') {
          const remaining = order.amount - order.filled;
          balances[socket.id] = (balances[socket.id] || 12480.5) + remaining * order.price;
        }
        io.to(order.giftName).emit('orderBook', getOrderBook(order.giftName));
        socket.emit(
          'userOrders',
          orders.filter((o) => o.userId === socket.id)
        );
      }
    });
  });

  if (process.env.NO_VITE !== 'true' && process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
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

startServer();
