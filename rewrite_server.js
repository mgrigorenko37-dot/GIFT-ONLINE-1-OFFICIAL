const fs = require('fs');
const content = `import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// API route to generate a Telegram Stars invoice link
app.post("/api/create-invoice", async (req: express.Request, res: express.Response) => {
  const { title, description, payload, currency, prices } = req.body;
  const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return res.status(500).json({ error: "BOT_TOKEN or TELEGRAM_BOT_TOKEN is not configured." });
  }

  try {
    const response = await fetch(\`https://api.telegram.org/bot\${botToken}/createInvoiceLink\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        payload,
        provider_token: "", // Must be empty for Telegram Stars
        currency,
        prices,
      }),
    });
    const data = await response.json();
    if (data.ok) {
      res.json({ invoiceLink: data.result });
    } else {
      console.error("Telegram API Error:", data);
      res.status(400).json({ error: data.description || "Failed to create invoice link." });
    }
  } catch (error) {
    console.error("Error creating invoice link:", error);
    res.status(500).json({ error: "Internal server error." });
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

// Seed some initial order book data
const seedData = () => {
  const gifts = ['durov-cap', 'berry-box', 'diamond-ring'];
  gifts.forEach(giftName => {
    let basePrice = 120;
    for (let i = 0; i < 15; i++) {
      orders.push({
        id: Math.random().toString(36).substr(2, 9),
        userId: 'system',
        giftName,
        side: 'sell',
        type: 'limit',
        price: parseFloat((basePrice + (i * 0.5) + Math.random() * 0.5).toFixed(2)),
        amount: Math.floor(Math.random() * 50) + 1,
        filled: 0,
        status: 'open',
        time: Date.now()
      });
      orders.push({
        id: Math.random().toString(36).substr(2, 9),
        userId: 'system',
        giftName,
        side: 'buy',
        type: 'limit',
        price: parseFloat((basePrice - (i * 0.5) - Math.random() * 0.5).toFixed(2)),
        amount: Math.floor(Math.random() * 50) + 1,
        filled: 0,
        status: 'open',
        time: Date.now()
      });
    }
  });
};
seedData();

const getOrderBook = (giftName: string) => {
  const activeOrders = orders.filter(o => o.giftName === giftName && o.status === 'open');
  
  // Aggregate bids by price
  const bidsMap = new Map<number, number>();
  const asksMap = new Map<number, number>();
  
  activeOrders.forEach(o => {
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
  return trades.filter(t => t.giftName === giftName).sort((a, b) => b.time - a.time).slice(0, 50);
};

const matchOrder = (order: Order, io: Server) => {
  const activeOrders = orders.filter(o => o.giftName === order.giftName && o.status === 'open' && o.side !== order.side);
  
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

    if (match.filled >= match.amount) match.status = 'filled';
    if (order.filled >= order.amount) order.status = 'filled';

    // Record trade
    const trade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      giftName: order.giftName,
      price: fillPrice,
      amount: fillAmount,
      time: Date.now(),
      takerSide: order.side
    };
    trades.push(trade);

    io.to(order.giftName).emit('trade', trade);
  }

  // Update order book
  io.to(order.giftName).emit('orderBook', getOrderBook(order.giftName));
};

async function startServer() {
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    let currentRoom = '';

    socket.on('subscribe', (giftName) => {
      if (currentRoom) socket.leave(currentRoom);
      socket.join(giftName);
      currentRoom = giftName;
      
      socket.emit('orderBook', getOrderBook(giftName));
      socket.emit('recentTrades', getTrades(giftName));
      // Send user's orders (mocking userId as socket.id for now)
      socket.emit('userOrders', orders.filter(o => o.userId === socket.id));
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
        time: Date.now()
      };
      
      orders.push(order);
      matchOrder(order, io);
      
      socket.emit('userOrders', orders.filter(o => o.userId === socket.id));
      socket.emit('orderPlaced', order);
    });

    socket.on('cancelOrder', (orderId) => {
      const order = orders.find(o => o.id === orderId && o.userId === socket.id);
      if (order && order.status === 'open') {
        order.status = 'cancelled';
        io.to(order.giftName).emit('orderBook', getOrderBook(order.giftName));
        socket.emit('userOrders', orders.filter(o => o.userId === socket.id));
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(\`Server running on http://localhost:\${PORT}\`);
  });
}

startServer();
`;
fs.writeFileSync('server.ts', content);
