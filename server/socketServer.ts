import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import { PostgresTradingEngine, Order as EngineOrder } from './tradingEngine';
import { getPgPool } from './marketRepository';
import { validateTelegramInitData, ValidatedTelegramUser } from './telegramAuth';
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

export interface AuthenticatedTelegramContext {
  type: 'telegram';
  userId: string;
  isDemo: false;
  telegramUser: ValidatedTelegramUser;
  authenticatedAt: number;
}

export interface DemoContext {
  type: 'demo';
  demoId: string;
  isDemo: true;
  authenticatedAt: number;
}

export type AuthenticatedSocketContext = AuthenticatedTelegramContext | DemoContext;

export function isTelegramContext(
  ctx: AuthenticatedSocketContext
): ctx is AuthenticatedTelegramContext {
  return Boolean(
    ctx && ctx.type === 'telegram' && ctx.isDemo === false && typeof ctx.userId === 'string'
  );
}

export function isDemoContext(ctx: AuthenticatedSocketContext): ctx is DemoContext {
  return Boolean(
    ctx && ctx.type === 'demo' && ctx.isDemo === true && typeof ctx.demoId === 'string'
  );
}

export async function handleGetUserOrders(
  ctx: AuthenticatedTelegramContext,
  tradingEngine: PostgresTradingEngine
) {
  if (!isTelegramContext(ctx)) {
    throw new Error('Security Error: Financial operations require AuthenticatedTelegramContext.');
  }
  return await tradingEngine.getUserOrders(ctx.userId);
}

export async function handleGetBalance(
  ctx: AuthenticatedTelegramContext,
  tradingEngine: PostgresTradingEngine
) {
  if (!isTelegramContext(ctx)) {
    throw new Error('Security Error: Financial operations require AuthenticatedTelegramContext.');
  }
  return await tradingEngine.getBalance(ctx.userId);
}

export async function handleGetPositions(
  ctx: AuthenticatedTelegramContext,
  tradingEngine: PostgresTradingEngine
) {
  if (!isTelegramContext(ctx)) {
    throw new Error('Security Error: Financial operations require AuthenticatedTelegramContext.');
  }
  return await tradingEngine.getAllPositions(ctx.userId);
}

export async function handleGetMarginInfo(
  ctx: AuthenticatedTelegramContext,
  tradingEngine: PostgresTradingEngine,
  currency: string = 'TON'
) {
  if (!isTelegramContext(ctx)) {
    throw new Error('Security Error: Financial operations require AuthenticatedTelegramContext.');
  }
  return await tradingEngine.getMarginInfo(ctx.userId, currency);
}

export async function handleGetUserTrades(
  ctx: AuthenticatedTelegramContext,
  tradingEngine: PostgresTradingEngine
) {
  if (!isTelegramContext(ctx)) {
    throw new Error('Security Error: Financial operations require AuthenticatedTelegramContext.');
  }
  return await tradingEngine.getUserTrades(ctx.userId);
}

export async function handlePlaceOrder(
  ctx: AuthenticatedTelegramContext,
  tradingEngine: PostgresTradingEngine,
  orderData: {
    giftName: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    amount: number;
    price: number;
    reduceOnly?: boolean;
  }
) {
  if (!isTelegramContext(ctx)) {
    throw new Error('Security Error: Financial operations require AuthenticatedTelegramContext.');
  }
  return await tradingEngine.placeOrder(
    {
      userId: ctx.userId,
      instrumentKey: orderData.giftName,
      side: orderData.side === 'buy' ? 'Buy' : 'Sell',
      orderType: orderData.type === 'limit' ? 'Limit' : 'Market',
      qty: Number(orderData.amount),
      price: Number(orderData.price) || 0,
      reduceOnly: orderData.reduceOnly === true,
    },
    true
  );
}

export async function handleCancelOrder(
  ctx: AuthenticatedTelegramContext,
  tradingEngine: PostgresTradingEngine,
  orderId: string
) {
  if (!isTelegramContext(ctx)) {
    throw new Error('Security Error: Financial operations require AuthenticatedTelegramContext.');
  }

  // Check ownership strictly against verified Telegram ID (ctx.userId)
  const userOrders = await tradingEngine.getUserOrders(ctx.userId);
  const ownsOrder = userOrders.some((o) => o.orderId === orderId);
  if (!ownsOrder) {
    throw new Error('Unauthorized to cancel this order: ownership verification failed.');
  }

  return await tradingEngine.cancelOrder(orderId);
}

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
    (o) =>
      (order.side === 'buy' ? o.side === 'Sell' : o.side === 'Buy') &&
      o.orderId !== engineOrder?.orderId
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
      await tradingEngine
        .executeTrade(engineOrder.orderId, fillAmount, fillPrice)
        .catch(console.error);
    }
    await tradingEngine.executeTrade(match.orderId, fillAmount, fillPrice).catch(console.error);
    await tradingEngine.updateMarkPrice(order.giftName, fillPrice).catch(console.error);

    const tradeEvent: Trade = {
      id: `trade_${crypto.randomUUID()}`,
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
  // Outbox & Realtime Engine Subscriptions: emit strictly to verified user room
  tradingEngine.on('orderCreated', (engineOrder: EngineOrder) => {
    io.to(engineOrder.instrumentKey).emit('orderCreated', engineOrder);
  });
  tradingEngine.on('executionReport', (execution: any) => {
    io.to(`user_${execution.userId}`).emit('executionReport', execution);
  });
  tradingEngine.on('positionUpdated', (position: any) => {
    io.to(`user_${position.userId}`).emit('positionUpdated', position);
  });
  tradingEngine.on('balanceUpdated', (data: any) => {
    io.to(`user_${data.userId}`).emit('balanceUpdated', data.balance);
  });
  tradingEngine.on('historyUpdated', (data: any) => {
    io.to(`user_${data.userId}`).emit('historyUpdated', data.trade);
  });

  // Strict Socket.io Authentication Middleware
  // Zero fallbacks to clientUserId or socket.id across all environments
  io.use((socket: Socket, next: (err?: Error) => void) => {
    const auth = socket.handshake.auth || {};
    const headers = socket.handshake.headers || {};

    const rawInitData = auth.initData || headers['x-telegram-init-data'];
    const isDemoRequested = auth.demoAuth === true || headers['x-demo-auth'] === 'true';
    const allowDemoAuth =
      process.env.ALLOW_DEMO_AUTH === 'true' || process.env.ALLOW_DEMO_MODE === 'true';

    // 1. Explicit DEMO_AUTH mode enabled ONLY when explicitly configured
    if (isDemoRequested) {
      if (!allowDemoAuth) {
        return next(
          new Error(
            'Authentication error: Demo authentication is disabled. Telegram initData is strictly required.'
          )
        );
      }

      const demoId = `demo_guest_${socket.id.substring(0, 8)}`;
      (socket as any).authContext = {
        type: 'demo',
        demoId,
        isDemo: true,
        authenticatedAt: Date.now(),
      } as DemoContext;
      return next();
    }

    // 2. Strict Telegram WebApp HMAC-SHA256 Authentication
    if (!rawInitData || typeof rawInitData !== 'string') {
      return next(new Error('Authentication error: Telegram initData is strictly required.'));
    }

    const authResult = validateTelegramInitData(rawInitData);
    if (!authResult.isValid || !authResult.user?.id) {
      return next(new Error('Authentication error: Invalid Telegram initData signature.'));
    }

    // Set verified Telegram User ID on authenticated socket context
    const verifiedUserId = String(authResult.user.id);
    (socket as any).authContext = {
      type: 'telegram',
      userId: verifiedUserId,
      isDemo: false,
      telegramUser: authResult.user,
      authenticatedAt: Date.now(),
    } as AuthenticatedTelegramContext;

    next();
  });

  io.on('connection', (socket: Socket) => {
    const authContext: AuthenticatedSocketContext = (socket as any).authContext;
    if (!authContext) {
      socket.disconnect(true);
      return;
    }

    const isDemo = isDemoContext(authContext);
    const isTelegram = isTelegramContext(authContext);

    if (!isDemo && !isTelegram) {
      socket.disconnect(true);
      return;
    }

    const privateRoom = isTelegram
      ? `user_${authContext.userId}`
      : `demo_user_${authContext.demoId}`;

    // Join only the verified user room or demo room
    socket.join(privateRoom);
    attachSocketListeners(socket);

    let currentRoom = '';

    // Guard: Prevent arbitrary joins to private user rooms or demo rooms
    socket.on('join_room', (roomToJoin: string) => {
      if (typeof roomToJoin !== 'string') return;

      if (isTelegram) {
        if (roomToJoin.startsWith('user_') && roomToJoin !== privateRoom) {
          socket.emit('error', { message: 'Security violation: Cannot join private user room.' });
          return;
        }
        if (roomToJoin.startsWith('demo_user_')) {
          socket.emit('error', { message: 'Security violation: Cannot join demo rooms.' });
          return;
        }
      } else if (isDemo) {
        if (roomToJoin.startsWith('user_')) {
          socket.emit('error', {
            message: 'Security violation: Demo context cannot join private user rooms.',
          });
          return;
        }
      }

      socket.join(roomToJoin);
    });

    socket.on('subscribe', async (giftName: string) => {
      if (currentRoom) socket.leave(currentRoom);
      socket.join(giftName);
      currentRoom = giftName;

      socket.emit('orderBook', await getOrderBook(tradingEngine, giftName));
      socket.emit('recentTrades', await getTrades(giftName));

      if (isDemoContext(authContext)) {
        // Sandboxed DEMO state: no PostgreSQL DB queries or state leakage
        socket.emit('userOrders', []);
        socket.emit('positions', []);
        socket.emit('balance', { available: 100, locked: 0, currency: 'TON' });
        socket.emit('marginInfo', { equity: 100, freeMargin: 100, marginUsed: 0, marginLevel: 0 });
        socket.emit('tradeHistory', []);
        return;
      }

      if (isTelegramContext(authContext)) {
        const userOrders = await handleGetUserOrders(authContext, tradingEngine);
        const mappedOrders = userOrders.map((o) => ({
          id: o.orderId,
          userId: authContext.userId,
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
        socket.emit('positions', await handleGetPositions(authContext, tradingEngine));
        socket.emit('balance', await handleGetBalance(authContext, tradingEngine));
        socket.emit('marginInfo', await handleGetMarginInfo(authContext, tradingEngine, 'TON'));
        socket.emit('tradeHistory', await handleGetUserTrades(authContext, tradingEngine));
      }
    });

    socket.on('getMarginInfo', async (currency: string = 'TON') => {
      if (isDemoContext(authContext)) {
        socket.emit('marginInfo', { equity: 100, freeMargin: 100, marginUsed: 0, marginLevel: 0 });
        return;
      }
      if (isTelegramContext(authContext)) {
        const margin = await handleGetMarginInfo(authContext, tradingEngine, currency);
        socket.emit('marginInfo', margin);
      }
    });

    socket.on('placeOrder', async (data: any) => {
      if (isDemoContext(authContext)) {
        socket.emit('orderRejected', {
          error: 'DEMO mode: Financial and trading operations are disabled.',
        });
        return;
      }

      if (!isTelegramContext(authContext)) {
        socket.emit('orderRejected', { error: 'Authentication required.' });
        return;
      }

      if (!data || !data.giftName || !data.amount || !data.side) {
        socket.emit('orderRejected', { error: 'Invalid order parameters' });
        return;
      }

      try {
        const engineOrder = await handlePlaceOrder(authContext, tradingEngine, data);

        if (engineOrder.status === 'Rejected') {
          socket.emit('orderRejected', engineOrder);
          return;
        }

        const order: Order = {
          id: engineOrder.orderId,
          userId: authContext.userId,
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

        const userOrders = await handleGetUserOrders(authContext, tradingEngine);
        const mappedOrders = userOrders.map((o) => ({
          id: o.orderId,
          userId: authContext.userId,
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
        socket.emit('positions', await handleGetPositions(authContext, tradingEngine));
        socket.emit('balance', await handleGetBalance(authContext, tradingEngine));
        socket.emit('marginInfo', await handleGetMarginInfo(authContext, tradingEngine, 'TON'));
      } catch (err: any) {
        socket.emit('orderRejected', { error: err.message || 'Order execution failed.' });
      }
    });

    socket.on('cancelOrder', async (orderId: string) => {
      if (isDemoContext(authContext)) {
        socket.emit('error', { message: 'DEMO mode: Order cancellation disabled.' });
        return;
      }

      if (!isTelegramContext(authContext)) {
        socket.emit('error', { message: 'Authentication required.' });
        return;
      }

      try {
        const engineOrder = await handleCancelOrder(authContext, tradingEngine, orderId);
        if (engineOrder) {
          io.to(engineOrder.instrumentKey).emit(
            'orderBook',
            await getOrderBook(tradingEngine, engineOrder.instrumentKey)
          );
          const updatedOrders = await handleGetUserOrders(authContext, tradingEngine);
          const mappedOrders = updatedOrders.map((o) => ({
            id: o.orderId,
            userId: authContext.userId,
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
          socket.emit('balance', await handleGetBalance(authContext, tradingEngine));
          socket.emit('positions', await handleGetPositions(authContext, tradingEngine));
          socket.emit('marginInfo', await handleGetMarginInfo(authContext, tradingEngine, 'TON'));
        }
      } catch (e: any) {
        socket.emit('error', {
          message: e.message || 'Unauthorized to cancel this order: ownership verification failed.',
        });
      }
    });
  });
}
