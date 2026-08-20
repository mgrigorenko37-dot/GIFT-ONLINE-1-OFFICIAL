import { describe, test, beforeAll, afterAll, expect, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as socketClient, Socket as ClientSocket } from 'socket.io-client';
import {
  attachSocketListeners,
  clearAllSubscriptions,
  getSocketSubscriptions,
  resetSequence,
} from './realtimeManager';
import { clearMarketState, acceptCompletedSale } from './marketState';
import { CandleStore, SequenceTracker } from '../src/lib/realtimeStream';
import { handleGetCandles } from './candlesHandler';
import { getSocketCorsOptions } from './corsConfig';

let server: http.Server;
let ioServer: SocketIOServer;
let serverUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.get('/api/market/candles', handleGetCandles);

  server = http.createServer(app);
  ioServer = new SocketIOServer(server, {
    cors: getSocketCorsOptions(),
  });

  ioServer.on('connection', (socket) => {
    attachSocketListeners(socket);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      serverUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (ioServer) ioServer.close();
  if (server) server.close();
});

const instA = 'durov-cap:all:all:TON';
const instB = 'pepe-hat:all:all:STARS';

describe('Stage 4: Single-Instance Realtime Backend Tests with Real Socket.io-Client', () => {
  beforeEach(() => {
    clearAllSubscriptions();
    clearMarketState();
    resetSequence(0);
  });

  test('1. Connect, market_subscribe, snapshot, candle_update, candle_closed, market_unsubscribe', async () => {
    const client: ClientSocket = socketClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));
    expect(client.connected).toBe(true);

    const receivedEvents: any[] = [];
    client.on('market_event', (data) => {
      receivedEvents.push(data);
    });

    // Subscribe
    client.emit('market_subscribe', { instrumentKey: instA, timeframe: '1m' });

    // Wait for snapshot
    await new Promise((r) => setTimeout(r, 150));

    const snapshot = receivedEvents.find((e) => e.type === 'snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot.instrumentKey).toBe(instA);

    // Trigger a sale -> candle_update
    receivedEvents.length = 0;
    acceptCompletedSale({
      id: 'sale-1',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '10',
      quantity: 1,
      eventTime: 1710000010000,
      status: 'completed',
    });

    await new Promise((r) => setTimeout(r, 150));

    const candleUpdate = receivedEvents.find((e) => e.type === 'candle_update');
    expect(candleUpdate).toBeDefined();
    expect(candleUpdate.candle.open).toBe('10');

    // Trigger sale in next minute -> candle_closed for minute 1, candle_update for minute 2
    receivedEvents.length = 0;
    acceptCompletedSale({
      id: 'sale-2',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '12',
      quantity: 1,
      eventTime: 1710000070000,
      status: 'completed',
    });

    await new Promise((r) => setTimeout(r, 150));

    const closedEvent = receivedEvents.find((e) => e.type === 'candle_closed');
    expect(closedEvent).toBeDefined();
    expect(closedEvent.candle.startTime).toBe(1710000000000);

    // Unsubscribe
    client.emit('market_unsubscribe', { instrumentKey: instA, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 100));

    receivedEvents.length = 0;
    acceptCompletedSale({
      id: 'sale-3',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '15',
      quantity: 1,
      eventTime: 1710000080000,
      status: 'completed',
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(receivedEvents.length).toBe(0); // No events after unsubscribe

    client.disconnect();
  });

  test('2. Timeframe switch and InstrumentKey switch', async () => {
    const client: ClientSocket = socketClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    const events: any[] = [];
    client.on('market_event', (e) => events.push(e));

    // Subscribe 1m
    client.emit('market_subscribe', { instrumentKey: instA, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.type === 'snapshot')).toBe(true);

    // Switch timeframe: unsubscribe 1m, subscribe 5m
    events.length = 0;
    client.emit('market_unsubscribe', { instrumentKey: instA, timeframe: '1m' });
    client.emit('market_subscribe', { instrumentKey: instA, timeframe: '5m' });
    await new Promise((r) => setTimeout(r, 100));

    const tf5mSnapshot = events.find((e) => e.type === 'snapshot');
    expect(tf5mSnapshot).toBeDefined();

    // Switch instrumentKey: unsubscribe instA, subscribe instB
    events.length = 0;
    client.emit('market_unsubscribe', { instrumentKey: instA, timeframe: '5m' });
    client.emit('market_subscribe', { instrumentKey: instB, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 100));

    const instBSnapshot = events.find((e) => e.type === 'snapshot' && e.instrumentKey === instB);
    expect(instBSnapshot).toBeDefined();

    client.disconnect();
  });

  test('3. Duplicate subscription idempotency & reconnect snapshot recovery', async () => {
    const client: ClientSocket = socketClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    const events: any[] = [];
    client.on('market_event', (e) => events.push(e));

    // Initial subscribe
    client.emit('market_subscribe', { instrumentKey: instA, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 100));
    const snapshotCount1 = events.filter((e) => e.type === 'snapshot').length;
    expect(snapshotCount1).toBe(1);

    // Duplicate subscribe
    client.emit('market_subscribe', { instrumentKey: instA, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 100));
    const snapshotCount2 = events.filter((e) => e.type === 'snapshot').length;
    expect(snapshotCount2).toBe(2); // Second snapshot emitted for recovery

    // Verify socket subscription count is still 1
    const subs = getSocketSubscriptions(client.id!);
    expect(subs.length).toBe(1);

    // Reconnect test
    client.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    events.length = 0;
    client.connect();
    await new Promise<void>((resolve) => client.on('connect', resolve));

    client.emit('market_subscribe', { instrumentKey: instA, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 100));

    const reconnectSnapshot = events.find((e) => e.type === 'snapshot');
    expect(reconnectSnapshot).toBeDefined();

    client.disconnect();
  });

  test('4. REST History loads via API', async () => {
    // Seed sales
    acceptCompletedSale({
      id: 'rest-sale-1',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '25',
      quantity: 1,
      eventTime: 1710000010000,
      status: 'completed',
    });

    const res = await fetch(
      `${serverUrl}/api/market/candles?instrumentKey=${encodeURIComponent(instA)}&timeframe=1m`
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json.candles)).toBe(true);
    expect(json.candles.length).toBeGreaterThan(0);
    expect(json.candles[0].open).toBe('25');
  });

  test('5. Equal revision logic (same data vs conflicting data)', () => {
    const store = new CandleStore(instA, '1m');

    const candle1 = {
      instrumentKey: instA,
      timeframe: '1m' as const,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '12',
      low: '9',
      close: '11',
      volume: '5',
      quoteVolume: '50',
      tradeCount: 3,
      confirmed: false,
      revision: 1,
      updatedAt: 1710000030000,
    };

    // First apply
    const res1 = store.applyCandle(candle1);
    expect(res1.updated).toBe(true);
    expect(res1.isNew).toBe(true);

    // Identical candle with same revision
    const res2 = store.applyCandle({ ...candle1 });
    expect(res2.updated).toBe(false);
    expect(res2.conflict).toBeUndefined();

    // Conflicting candle with same revision but different close price
    const res3 = store.applyCandle({ ...candle1, close: '99' });
    expect(res3.updated).toBe(false);
    expect(res3.conflict).toBe(true);
  });

  test('6. Stale Socket.io event doesn not overwrite higher revision', () => {
    const store = new CandleStore(instA, '1m');

    const rev2 = {
      instrumentKey: instA,
      timeframe: '1m' as const,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '15',
      low: '9',
      close: '15',
      volume: '10',
      quoteVolume: '100',
      tradeCount: 5,
      confirmed: false,
      revision: 2,
      updatedAt: 1710000040000,
    };

    const rev1 = {
      instrumentKey: instA,
      timeframe: '1m' as const,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '10',
      low: '10',
      close: '10',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      confirmed: false,
      revision: 1,
      updatedAt: 1710000010000,
    };

    store.applyCandle(rev2);
    const resStale = store.applyCandle(rev1);

    expect(resStale.updated).toBe(false);
    const candles = store.getSortedCandles();
    expect(candles[0].revision).toBe(2);
    expect(candles[0].close).toBe('15');
  });

  test('7. No listener leaks on disconnect', async () => {
    const client: ClientSocket = socketClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));
    client.emit('market_subscribe', { instrumentKey: instA, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 100));

    expect(getSocketSubscriptions(client.id!).length).toBe(1);

    client.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(getSocketSubscriptions(client.id!).length).toBe(0);
  });
});
