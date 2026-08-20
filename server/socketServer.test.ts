import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO, Socket as ClientSocket } from 'socket.io-client';
import crypto from 'crypto';
import { setupSocketServer } from './socketServer';
import { PostgresTradingEngine } from './tradingEngine';
import { getSocketCorsOptions } from './corsConfig';

// Helper to create genuine Telegram WebApp initData HMAC-SHA256
function generateValidTelegramInitData(
  botToken: string,
  user: { id: number; first_name: string; username?: string }
) {
  const authDate = Math.floor(Date.now() / 1000);
  const userJson = JSON.stringify(user);

  const params: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: userJson,
  };

  const dataCheckArr = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`);
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return `auth_date=${params.auth_date}&query_id=${params.query_id}&user=${encodeURIComponent(userJson)}&hash=${hash}`;
}

describe('Socket.IO Strict Telegram Auth & Zero Fallback Tests', () => {
  const TEST_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxyz';
  let httpServer: any;
  let ioServer: SocketIOServer;
  let port: number;
  let mockEngine: any;

  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;

    mockEngine = {
      on: vi.fn(),
      getActiveOrders: vi.fn().mockResolvedValue([]),
      getUserOrders: vi.fn().mockResolvedValue([]),
      getAllPositions: vi.fn().mockResolvedValue([]),
      getBalance: vi.fn().mockResolvedValue({ available: 50, locked: 10, currency: 'TON' }),
      getMarginInfo: vi
        .fn()
        .mockResolvedValue({ equity: 50, freeMargin: 40, marginUsed: 10, marginLevel: 500 }),
      getUserTrades: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn().mockResolvedValue({
        orderId: 'order_test_123',
        userId: '999888',
        instrumentKey: 'gift_red_star:TON',
        side: 'Buy',
        orderType: 'Limit',
        price: 5,
        qty: 1,
        executedQty: 0,
        remainingQty: 1,
        status: 'New',
        createdAt: Date.now(),
      }),
      cancelOrder: vi.fn().mockResolvedValue({
        orderId: 'order_own_1',
        userId: '999888',
        instrumentKey: 'gift_red_star:TON',
      }),
      executeTrade: vi.fn(),
      updateMarkPrice: vi.fn(),
    } as unknown as PostgresTradingEngine;

    httpServer = createServer();
    ioServer = new SocketIOServer(httpServer, {
      cors: getSocketCorsOptions(),
    });

    setupSocketServer(ioServer, mockEngine);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    if (ioServer) {
      ioServer.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('1. Connection fails and is rejected if initData is missing (no fallback to clientUserId or socket.id)', async () => {
    let connectError: any = null;

    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        userId: 'untrusted_spoofed_user_123', // Client tries to spoof userId
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on('connect_error', (err) => {
        connectError = err;
        resolve();
      });
      client.on('connect', () => {
        resolve();
      });
    });

    expect(connectError).toBeDefined();
    expect(connectError.message).toContain('Telegram initData is strictly required');
    expect(client.connected).toBe(false);
    client.close();
  });

  it('2. Connection fails if initData signature is invalid or tampered with', async () => {
    let connectError: any = null;

    const fakeInitData =
      'auth_date=1700000000&user=%7B%22id%22%3A999888%7D&hash=invalid_hash_signature_123';

    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        initData: fakeInitData,
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on('connect_error', (err) => {
        connectError = err;
        resolve();
      });
      client.on('connect', () => {
        resolve();
      });
    });

    expect(connectError).toBeDefined();
    expect(connectError.message).toContain('Invalid Telegram initData signature');
    expect(client.connected).toBe(false);
    client.close();
  });

  it('3. Connection succeeds with genuine Telegram initData and binds verified identity', async () => {
    const validInitData = generateValidTelegramInitData(TEST_BOT_TOKEN, {
      id: 999888,
      first_name: 'Alice',
      username: 'alice_trader',
    });

    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        initData: validInitData,
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        resolve();
      });
    });

    expect(client.connected).toBe(true);

    // Verify room join: listen for private user events
    let receivedExecution: any = null;
    client.on('executionReport', (data) => {
      receivedExecution = data;
    });

    // Simulate trading engine emitting private execution report for 999888
    ioServer.to('user_999888').emit('executionReport', {
      orderId: 'ord_1',
      userId: '999888',
      side: 'Buy',
      price: 5.5,
      qty: 1,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(receivedExecution).toBeDefined();
    expect(receivedExecution.userId).toBe('999888');

    client.close();
  });

  it('4. Attempting to spoof clientUserId in placeOrder uses strictly verified Telegram ID', async () => {
    const validInitData = generateValidTelegramInitData(TEST_BOT_TOKEN, {
      id: 999888,
      first_name: 'Alice',
    });

    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        initData: validInitData,
        userId: 'attacker_fake_identity_666', // Client tries to spoof another user
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    client.emit('placeOrder', {
      giftName: 'gift_red_star:TON',
      amount: 1,
      price: 5,
      side: 'buy',
      type: 'limit',
      userId: 'victim_user_777', // Injected spoofed victim ID in body
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockEngine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '999888', // MUST be authenticated Telegram ID, NOT victim_user_777
        instrumentKey: 'gift_red_star:TON',
      }),
      true
    );

    client.close();
  });

  it("5. Ownership verification on cancelOrder prevents cancelling another user's order", async () => {
    // Mock user orders: order_1 belongs to user 999888, order_2 belongs to victim 777
    mockEngine.getUserOrders.mockResolvedValue([
      {
        orderId: 'order_1',
        userId: '999888',
        instrumentKey: 'gift_red_star:TON',
        side: 'Buy',
        orderType: 'Limit',
        price: 5,
        qty: 1,
        executedQty: 0,
        status: 'New',
        createdAt: 1000,
      },
    ]);

    const validInitData = generateValidTelegramInitData(TEST_BOT_TOKEN, {
      id: 999888,
      first_name: 'Alice',
    });

    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        initData: validInitData,
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    let receivedError: any = null;
    client.on('error', (err) => {
      receivedError = err;
    });

    // Try to cancel an order not owned by 999888
    client.emit('cancelOrder', 'order_2_victim');

    await new Promise((r) => setTimeout(r, 50));

    expect(receivedError).toBeDefined();
    expect(receivedError.message).toContain('Unauthorized to cancel this order');
    expect(mockEngine.cancelOrder).not.toHaveBeenCalledWith('order_2_victim');

    client.close();
  });

  it("6. Attempting to join another user's private room emits security violation error", async () => {
    const validInitData = generateValidTelegramInitData(TEST_BOT_TOKEN, {
      id: 999888,
      first_name: 'Alice',
    });

    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        initData: validInitData,
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    let receivedError: any = null;
    client.on('error', (err) => {
      receivedError = err;
    });

    // Attacker tries to eavesdrop on victim user_777 room
    client.emit('join_room', 'user_777');

    await new Promise((r) => setTimeout(r, 50));

    expect(receivedError).toBeDefined();
    expect(receivedError.message).toContain('Security violation: Cannot join private user room');

    client.close();
  });

  it('7. DEMO_AUTH request fails when ALLOW_DEMO_AUTH env flag is disabled', async () => {
    delete process.env.ALLOW_DEMO_AUTH;
    delete process.env.ALLOW_DEMO_MODE;

    let connectError: any = null;
    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        demoAuth: true,
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on('connect_error', (err) => {
        connectError = err;
        resolve();
      });
      client.on('connect', () => resolve());
    });

    expect(connectError).toBeDefined();
    expect(connectError.message).toContain('Demo authentication is disabled');
    expect(client.connected).toBe(false);
    client.close();
  });

  it('8. DEMO_AUTH mode provides isolated sandbox when ALLOW_DEMO_AUTH is true', async () => {
    process.env.ALLOW_DEMO_AUTH = 'true';

    const client: ClientSocket = ClientIO(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: {
        demoAuth: true,
      },
      reconnection: false,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    expect(client.connected).toBe(true);

    let rejectedEvent: any = null;
    client.on('orderRejected', (err) => {
      rejectedEvent = err;
    });

    // Attempt financial order in DEMO mode
    client.emit('placeOrder', {
      giftName: 'gift_red_star:TON',
      amount: 1,
      price: 5,
      side: 'buy',
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent.error).toContain(
      'DEMO mode: Financial and trading operations are disabled'
    );
    expect(mockEngine.placeOrder).not.toHaveBeenCalled();

    // Attempt room join violation in DEMO mode
    let roomError: any = null;
    client.on('error', (err) => {
      roomError = err;
    });

    client.emit('join_room', 'user_999888');
    await new Promise((r) => setTimeout(r, 50));

    expect(roomError).toBeDefined();
    expect(roomError.message).toContain('Demo context cannot join private user rooms');

    delete process.env.ALLOW_DEMO_AUTH;
    client.close();
  });

  it('9. Financial handler helper functions strictly reject DemoContext at runtime', async () => {
    const {
      handleGetUserOrders,
      handleGetBalance,
      handleGetPositions,
      handleGetMarginInfo,
      handleGetUserTrades,
      handlePlaceOrder,
      handleCancelOrder,
    } = await import('./socketServer');

    const demoCtx: any = {
      type: 'demo',
      demoId: 'demo_guest_12345',
      isDemo: true,
      authenticatedAt: Date.now(),
    };

    await expect(handleGetUserOrders(demoCtx, mockEngine)).rejects.toThrow(
      'Security Error: Financial operations require AuthenticatedTelegramContext.'
    );
    await expect(handleGetBalance(demoCtx, mockEngine)).rejects.toThrow(
      'Security Error: Financial operations require AuthenticatedTelegramContext.'
    );
    await expect(handleGetPositions(demoCtx, mockEngine)).rejects.toThrow(
      'Security Error: Financial operations require AuthenticatedTelegramContext.'
    );
    await expect(handleGetMarginInfo(demoCtx, mockEngine)).rejects.toThrow(
      'Security Error: Financial operations require AuthenticatedTelegramContext.'
    );
    await expect(handleGetUserTrades(demoCtx, mockEngine)).rejects.toThrow(
      'Security Error: Financial operations require AuthenticatedTelegramContext.'
    );
    await expect(
      handlePlaceOrder(demoCtx, mockEngine, {
        giftName: 'gift_1',
        side: 'buy',
        type: 'limit',
        amount: 1,
        price: 5,
      })
    ).rejects.toThrow('Security Error: Financial operations require AuthenticatedTelegramContext.');
    await expect(handleCancelOrder(demoCtx, mockEngine, 'ord_1')).rejects.toThrow(
      'Security Error: Financial operations require AuthenticatedTelegramContext.'
    );
  });
});
