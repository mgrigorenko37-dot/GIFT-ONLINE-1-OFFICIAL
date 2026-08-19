import { Server } from 'socket.io';
import { PostgresTradingEngine, Order as EngineOrder } from './tradingEngine';
import { getPgPool } from './marketRepository';
import { validateTelegramInitData } from './telegramAuth';
import { attachSocketListeners } from './realtimeManager';

export type Order = {
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

export type Trade = {
  id: string;
  giftName: string;
  price: number;
  amount: number;
  time: number;
  takerSide: 'buy' | 'sell';
};

export const getOrderBook = async (tradingEngine: PostgresTradingEngine, giftName: string) => {
  try {
    const activeOrders = await tradingEngine.getActiveOrders(giftName);
    const bidsMap = new Map<number, number>();
    const asksMap = new Map<number, number>();

    activeOrders.forEach((o) => {
      const remaining = o.remainingQty;
      if (remaining <= 0) return;
      if (o.side === 'Buy') {
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
  } catch (e) {
    console.error('[OrderBook] Error fetching book:', e);
    return { bids: [], asks: [] };
  }
};

export const getTrades = async (giftName: string) => {
  try {
    const pool = getPgPool();
    const res = await pool.query(
      'SELECT trade_id as id, instrument_key as "giftName", price, qty as amount, timestamp as time, LOWER(side) as "takerSide" FROM te_trades WHERE instrument_key = $1 ORDER BY timestamp DESC LIMIT 50',
      [giftName]
    );
    return res.rows.map((r) => ({
      id: r.id,
      giftName: r.giftName,
      price: Number(r.price),
      amount: Number(r.amount),
      time: Number(r.time),
      takerSide: r.takerSide,
    }));
  } catch (e) {
    return [];
  }
};

export const matchOrder = async (
  tradingEngine: PostgresTradingEngine,
  order: Order,
  io: Server,
  engineOrder?: any
) => {
  const activeOrders = await tradingEngine.getActiveOrders(order.giftName);
  const oppositeOrders = activeOrders.filter(
    (o) => (order.side === 'buy' ? o.side === 'Sell' : o.side === 'Buy') && o.orderId !== engineOrder?.orderId
  );

  if (order.side === 'buy') {
    oppositeOrders.sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
  } else {
    oppositeOrders.sort((a, b) => b.price - a.price || a.createdAt - b.createdAt);
  }

  let remainingToFill = engineOrder ? engineOrder.remainingQty : order.amount - order.filled;
  for (const match of oppositeOrders) {
    if (remainingToFill <= 0) break;

    if (order.type === 'limit') {
      if (order.side === 'buy' && order.price < match.price) break;
      if (order.side === 'sell' && order.price > match.price) break;
    }

    const available = match.remainingQty;
    const fillAmount = Math.min(remainingToFill, available);
    const fillPrice = match.price;

    remainingToFill -= fillAmount;

    if (engineOrder) {
      await tradingEngine.executeTrade(engineOrder.orderId, fillAmount, fillPrice).catch(console.error);
    }
    await tradingEngine.executeTrade(match.orderId, fillAmount, fillPrice).catch(console.error);
    await tradingEngine.updateMarkPrice(order.giftName, fillPrice).catch(console.error);

    const tradeEvent: Trade = {
      id: Math.random().toString(36).substring(2, 11),
      giftName: order.giftName,
      price: fillPrice,
      amount: fillAmount,
      time: Date.now(),
      takerSide: order.side,
    };
    io.to(order.giftName).emit('trade', tradeEvent);
  }

  const updatedBook = await getOrderBook(tradingEngine, order.giftName);
  io.to(order.giftName).emit('orderBook', updatedBook);
};

export function setupSocketServer(io: Server, tradingEngine: PostgresTradingEngine) {
  // Outbox & Realtime Engine Subscriptions
  tradingEngine.on('orderCreated', (engineOrder: EngineOrder) => {
    io.to(engineOrder.instrumentKey).emit('orderCreated', engineOrder);
  });
  tradingEngine.on('executionReport', (execution: any) => {
    io.to(execution.userId).emit('executionReport', execution);
  });
  tradingEngine.on('positionUpdated', (position: any) => {
    io.to(position.userId).emit('positionUpdated', position);
  });
  tradingEngine.on('balanceUpdated', (data: any) => {
    io.to(data.userId).emit('balanceUpdated', data.balance);
  });
  tradingEngine.on('historyUpdated', (data: any) => {
    io.to(data.userId).emit('historyUpdated', data.trade);
  });

  // Socket.io Auth Middleware
  io.use((socket, next) => {
    const initData = socket.handshake.auth?.initData || socket.handshake.headers['x-telegram-init-data'];

    if (initData) {
      const authResult = validateTelegramInitData(initData);
      if (authResult.isValid && authResult.user?.id) {
        (socket as any).userId = String(authResult.user.id);
        (socket as any).telegramUser = authResult.user;
        (socket as any).isAuthenticated = true;
        return next();
      }
    }

    if (process.env.NODE_ENV === 'production') {
      return next(new Error('Authentication error: Telegram initData is required in production'));
    }

    const clientUserId = socket.handshake.auth?.userId;
    (socket as any).userId = clientUserId ? String(clientUserId) : socket.id;
    (socket as any).isAuthenticated = false;
    next();
  });

  io.on('connection', (socket) => {
    let currentRoom = '';
    const userId = (socket as any).userId || socket.id;

    socket.join(userId);
    attachSocketListeners(socket);

    socket.on('subscribe', async (giftName) => {
      if (currentRoom) socket.leave(currentRoom);
      socket.join(giftName);
      currentRoom = giftName;

      socket.emit('orderBook', await getOrderBook(tradingEngine, giftName));
      socket.emit('recentTrades', await getTrades(giftName));

      const userOrders = await tradingEngine.getUserOrders(userId);
      const mappedOrders = userOrders.map((o) => ({
        id: o.orderId,
        userId: o.userId,
        giftName: o.instrumentKey,
        side: o.side.toLowerCase(),
        type: o.orderType.toLowerCase(),
        price: o.price,
        amount: o.qty,
        filled: o.executedQty,
        status: o.status.toLowerCase(),
        time: o.createdAt,
      }));
      socket.emit('userOrders', mappedOrders);
      socket.emit('positions', await tradingEngine.getAllPositions(userId));
      socket.emit('balance', await tradingEngine.getBalance(userId));
      socket.emit('marginInfo', await tradingEngine.getMarginInfo(userId, 'TON'));
      socket.emit('tradeHistory', await tradingEngine.getUserTrades(userId));
    });

    socket.on('getMarginInfo', async (currency: string = 'TON') => {
      const margin = await tradingEngine.getMarginInfo(userId, currency);
      socket.emit('marginInfo', margin);
    });

    socket.on('placeOrder', async (data) => {
      if (!data || !data.giftName || !data.amount || !data.side) {
        socket.emit('orderRejected', { error: 'Invalid order parameters' });
        return;
      }

      const engineOrder = await tradingEngine.placeOrder(
        {
          userId: userId,
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

      const order: Order = {
        id: engineOrder.orderId,
        userId: userId,
        giftName: data.giftName,
        side: data.side,
        type: data.type,
        price: Number(data.price),
        amount: Number(data.amount),
        filled: 0,
        status: 'open',
        time: Date.now(),
      };

      await matchOrder(tradingEngine, order, io, engineOrder);

      const userOrders = await tradingEngine.getUserOrders(userId);
      const mappedOrders = userOrders.map((o) => ({
        id: o.orderId,
        userId: o.userId,
        giftName: o.instrumentKey,
        side: o.side.toLowerCase(),
        type: o.orderType.toLowerCase(),
        price: o.price,
        amount: o.qty,
        filled: o.executedQty,
        status: o.status.toLowerCase(),
        time: o.createdAt,
      }));

      socket.emit('userOrders', mappedOrders);
      socket.emit('positions', await tradingEngine.getAllPositions(userId));
      socket.emit('balance', await tradingEngine.getBalance(userId));
      socket.emit('marginInfo', await tradingEngine.getMarginInfo(userId, 'TON'));
    });

    socket.on('cancelOrder', async (orderId) => {
      const userOrders = await tradingEngine.getUserOrders(userId);
      const ownsOrder = userOrders.some((o) => o.orderId === orderId);
      if (!ownsOrder) {
        socket.emit('error', { message: 'Unauthorized to cancel this order' });
        return;
      }

      const engineOrder = await tradingEngine.cancelOrder(orderId);
      if (engineOrder) {
        io.to(engineOrder.instrumentKey).emit('orderBook', await getOrderBook(tradingEngine, engineOrder.instrumentKey));
        const updatedOrders = await tradingEngine.getUserOrders(userId);
        const mappedOrders = updatedOrders.map((o) => ({
          id: o.orderId,
          userId: o.userId,
          giftName: o.instrumentKey,
          side: o.side.toLowerCase(),
          type: o.orderType.toLowerCase(),
          price: o.price,
          amount: o.qty,
          filled: o.executedQty,
          status: o.status.toLowerCase(),
          time: o.createdAt,
        }));
        socket.emit('userOrders', mappedOrders);
        socket.emit('balance', await tradingEngine.getBalance(userId));
        socket.emit('positions', await tradingEngine.getAllPositions(userId));
        socket.emit('marginInfo', await tradingEngine.getMarginInfo(userId, 'TON'));
      }
    });
  });
}
