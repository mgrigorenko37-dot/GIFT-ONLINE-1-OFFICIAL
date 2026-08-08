import { simulateSales } from "./server/mockMinter";
import { getHistory, processSale } from "./server/marketState";
import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

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
app.get('/api/market/candles', (req, res) => {
  const rawKey = req.query.instrumentKey ? String(req.query.instrumentKey) : '';
  const rawTf = req.query.timeframe ? String(req.query.timeframe) as Timeframe : '1m';
  if (!rawKey || !rawTf) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  const normKey = normalizeInstrumentKey(rawKey);
  const fromTime = req.query.from ? parseInt(String(req.query.from)) : 0;
  const toTime = req.query.to ? parseInt(String(req.query.to)) : Date.now() + 86400000;
  const l = req.query.limit ? parseInt(String(req.query.limit)) : 500;
  
  const candles = getHistory(normKey, rawTf, fromTime, toTime, l);
  res.json({
    instrumentKey: normKey,
    timeframe: rawTf,
    timezone: "UTC",
    candles,
    hasMore: candles.length === l,
    serverTime: Date.now()
  });
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

async function startServer() {
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  simulateSales(io);
  io.on('connection', (socket) => {
    let currentRoom = '';

    
    socket.on('market_subscribe', (data) => {
      if (data?.channel === 'gift_market' && data?.instrumentKey) {
        const normKey = normalizeInstrumentKey(String(data.instrumentKey));
        const room = `market_${normKey}`;
        socket.join(room);
        console.log(`Client ${socket.id} joined ${room}`);
      }
    });
    
    socket.on('market_unsubscribe', (data) => {
      if (data?.channel === 'gift_market' && data?.instrumentKey) {
        const normKey = normalizeInstrumentKey(String(data.instrumentKey));
        const room = `market_${normKey}`;
        socket.leave(room);
        console.log(`Client ${socket.id} left ${room}`);
      }
    });

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

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
