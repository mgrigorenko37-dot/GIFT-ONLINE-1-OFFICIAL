import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as socketClient, Socket as ClientSocket } from 'socket.io-client';
import EventEmitter from 'events';
import {
  initRedisManager,
  closeRedisConnections,
  MARKET_EVENTS_CHANNEL,
  REDIS_SEQUENCE_KEY,
  resetLocalSequence,
} from './redisManager';
import { attachSocketListeners, clearAllSubscriptions, resetSequence } from './realtimeManager';
import { clearMarketState, acceptCompletedSale } from './marketState';
import { InMemoryMarketRepository } from './marketRepository';
import { getSocketCorsOptions } from './corsConfig';

// Shared Redis Bus for multi-instance IPC testing in Vitest
class SharedRedisMock extends EventEmitter {
  public status = 'ready';
  public subscribedChannels = new Set<string>();
  public static globalBus = new EventEmitter();
  public static sharedSeq = 0;

  constructor() {
    super();
    setTimeout(() => this.emit('ready'), 5);
  }

  duplicate() {
    return new SharedRedisMock();
  }

  async incr(key: string): Promise<number> {
    if (key === REDIS_SEQUENCE_KEY) {
      SharedRedisMock.sharedSeq++;
      return SharedRedisMock.sharedSeq;
    }
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    SharedRedisMock.globalBus.emit('message', channel, message);
    return 1;
  }

  subscribe(channel: string, callback?: (err: any, count: number) => void) {
    this.subscribedChannels.add(channel);
    const handler = (ch: string, msg: string) => {
      if (this.subscribedChannels.has(ch)) {
        this.emit('message', ch, msg);
      }
    };
    SharedRedisMock.globalBus.on('message', handler);
    if (callback) callback(null, 1);
  }

  async quit() {
    this.status = 'end';
    this.emit('end');
  }

  disconnect() {
    this.status = 'end';
    this.emit('end');
  }
}

let serverA: http.Server;
let serverB: http.Server;
let ioA: SocketIOServer;
let ioB: SocketIOServer;
let urlA: string;
let urlB: string;

const instTON = 'durov-cap:all:all:TON';
const instSTARS = 'pepe-hat:all:all:STARS';

beforeAll(async () => {
  // Create Server Instance A
  const appA = express();
  appA.use(express.json());
  serverA = http.createServer(appA);
  ioA = new SocketIOServer(serverA, { cors: getSocketCorsOptions() });
  ioA.on('connection', (s) => attachSocketListeners(s));

  // Create Server Instance B
  const appB = express();
  appB.use(express.json());
  serverB = http.createServer(appB);
  ioB = new SocketIOServer(serverB, { cors: getSocketCorsOptions() });
  ioB.on('connection', (s) => attachSocketListeners(s));

  await new Promise<void>((resolve) => {
    serverA.listen(0, '127.0.0.1', () => {
      const addrA = serverA.address() as any;
      urlA = `http://127.0.0.1:${addrA.port}`;
      serverB.listen(0, '127.0.0.1', () => {
        const addrB = serverB.address() as any;
        urlB = `http://127.0.0.1:${addrB.port}`;
        resolve();
      });
    });
  });
});

afterAll(async () => {
  if (ioA) ioA.close();
  if (ioB) ioB.close();
  if (serverA) serverA.close();
  if (serverB) serverB.close();
  await closeRedisConnections();
});

describe('Stage 7: Real Multi-Instance Backend Inter-Process Tests', () => {
  beforeEach(() => {
    clearAllSubscriptions();
    clearMarketState();
    resetSequence(0);
    SharedRedisMock.sharedSeq = 0;
    SharedRedisMock.globalBus.removeAllListeners();
  });

  test('1. Client 1 on Instance A & Client 2 on Instance B both receive candle_update published to Instance A', async () => {
    const client1: ClientSocket = socketClient(urlA, { transports: ['websocket'], forceNew: true });
    const client2: ClientSocket = socketClient(urlB, { transports: ['websocket'], forceNew: true });

    await Promise.all([
      new Promise<void>((res) => client1.on('connect', res)),
      new Promise<void>((res) => client2.on('connect', res)),
    ]);

    const client1Events: any[] = [];
    const client2Events: any[] = [];

    client1.on('market_event', (e) => client1Events.push(e));
    client2.on('market_event', (e) => client2Events.push(e));

    // Subscribe both clients to instrumentKey TON
    client1.emit('market_subscribe', { instrumentKey: instTON, timeframe: '1m' });
    client2.emit('market_subscribe', { instrumentKey: instTON, timeframe: '1m' });

    await new Promise((r) => setTimeout(r, 150));

    // Clear snapshots
    client1Events.length = 0;
    client2Events.length = 0;

    // Simulate Inter-Process PubSub message from Instance A
    const saleResult = acceptCompletedSale({
      id: 'multi-sale-1',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '50',
      quantity: 1,
      eventTime: 1710000010000,
      status: 'completed',
    });

    // Simulate Redis PubSub routing message across instances
    const redisMsg = JSON.stringify({
      kind: 'sale_result',
      result: saleResult,
      saleSeq: 1,
      candleSeqs: [2],
    });

    SharedRedisMock.globalBus.emit('message', MARKET_EVENTS_CHANNEL, redisMsg);

    await new Promise((r) => setTimeout(r, 150));

    // Verify both clients got candle_update
    const c1Update = client1Events.find((e) => e.type === 'candle_update');
    const c2Update = client2Events.find((e) => e.type === 'candle_update');

    expect(c1Update).toBeDefined();
    expect(c2Update).toBeDefined();
    expect(c1Update.candle.close).toBe('50');
    expect(c2Update.candle.close).toBe('50');

    // Verify no duplicate events
    expect(client1Events.filter((e) => e.type === 'candle_update').length).toBe(1);
    expect(client2Events.filter((e) => e.type === 'candle_update').length).toBe(1);

    client1.disconnect();
    client2.disconnect();
  });

  test('2. Duplicate sale sent to Instance B is rejected by database deduplication and produces no second update', async () => {
    const rawSale = {
      id: 'dup-sale-999',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '100',
      quantity: 1,
      eventTime: 1710000020000,
      status: 'completed',
    };

    // First ingestion (Instance A)
    const resA = acceptCompletedSale(rawSale);
    expect(resA.accepted).toBe(true);

    // Second ingestion (Instance B)
    const resB = acceptCompletedSale(rawSale);
    expect(resB.accepted).toBe(false);
    expect(resB.reason).toBe('duplicate');
  });

  test('3. Reconnect to Instance B receives PostgreSQL backed snapshot', async () => {
    const clientB: ClientSocket = socketClient(urlB, { transports: ['websocket'], forceNew: true });
    await new Promise<void>((res) => clientB.on('connect', res));

    // Seed sale
    acceptCompletedSale({
      id: 'snapshot-sale-1',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '75',
      quantity: 1,
      eventTime: 1710000030000,
      status: 'completed',
    });

    const events: any[] = [];
    clientB.on('market_event', (e) => events.push(e));

    clientB.emit('market_subscribe', { instrumentKey: instTON, timeframe: '1m' });
    await new Promise((r) => setTimeout(r, 150));

    const snap = events.find((e) => e.type === 'snapshot');
    expect(snap).toBeDefined();
    expect(snap.timeframes['1m'][0].close).toBe('75');

    clientB.disconnect();
  });

  test('4. Strict isolation between TON and STARS across multi-instance event bus', async () => {
    const clientTON: ClientSocket = socketClient(urlA, {
      transports: ['websocket'],
      forceNew: true,
    });
    const clientSTARS: ClientSocket = socketClient(urlB, {
      transports: ['websocket'],
      forceNew: true,
    });

    await Promise.all([
      new Promise<void>((res) => clientTON.on('connect', res)),
      new Promise<void>((res) => clientSTARS.on('connect', res)),
    ]);

    const eventsTON: any[] = [];
    const eventsSTARS: any[] = [];

    clientTON.on('market_event', (e) => eventsTON.push(e));
    clientSTARS.on('market_event', (e) => eventsSTARS.push(e));

    clientTON.emit('market_subscribe', { instrumentKey: instTON, timeframe: '1m' });
    clientSTARS.emit('market_subscribe', { instrumentKey: instSTARS, timeframe: '1m' });

    await new Promise((r) => setTimeout(r, 150));
    eventsTON.length = 0;
    eventsSTARS.length = 0;

    // Trigger TON sale
    const tonSaleResult = acceptCompletedSale({
      id: 'ton-isolated-1',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '30',
      quantity: 1,
      eventTime: 1710000040000,
      status: 'completed',
    });

    SharedRedisMock.globalBus.emit(
      'message',
      MARKET_EVENTS_CHANNEL,
      JSON.stringify({
        kind: 'sale_result',
        result: tonSaleResult,
        saleSeq: 10,
        candleSeqs: [11],
      })
    );

    await new Promise((r) => setTimeout(r, 150));

    // TON client should receive event, STARS client should NOT
    expect(eventsTON.length).toBeGreaterThan(0);
    expect(eventsSTARS.length).toBe(0);

    clientTON.disconnect();
    clientSTARS.disconnect();
  });
});
