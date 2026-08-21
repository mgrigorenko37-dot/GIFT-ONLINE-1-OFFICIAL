import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';
import { restApiRateLimiter, resetRateLimiters, requestTimeoutMiddleware } from './rateLimiter';
import {
  initRealtimeManager,
  resetSequence,
  clearAllSubscriptions,
  resetSocketIpConnectionCounts,
} from './realtimeManager';
import { processTelegramMarketEvent } from './telegramAdapter';
import {
  clearMarketState,
  setMarketRepository,
  getMarketSnapshot,
  acceptCompletedSale,
} from './marketState';
import { InMemoryMarketRepository } from './marketRepository';
import { getSocketCorsOptions } from './corsConfig';

interface LoadMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latenciesMs: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rps: number;
  durationMs: number;
}

function calculateMetrics(
  latencies: number[],
  durationMs: number,
  totalRequests: number,
  successCount: number
): LoadMetrics {
  const sorted = [...latencies].sort((a, b) => a - b);
  const failedRequests = totalRequests - successCount;
  const p50Ms = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
  const p95Ms = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const p99Ms = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0;
  const rps = durationMs > 0 ? totalRequests / (durationMs / 1000) : 0;

  return {
    totalRequests,
    successfulRequests: successCount,
    failedRequests,
    latenciesMs: sorted,
    p50Ms: Math.round(p50Ms * 100) / 100,
    p95Ms: Math.round(p95Ms * 100) / 100,
    p99Ms: Math.round(p99Ms * 100) / 100,
    rps: Math.round(rps * 10) / 10,
    durationMs,
  };
}

describe('Stage 10: Production Load & Stress Testing Harness', () => {
  let app: express.Express;
  let server: HttpServer;
  let io: SocketIOServer;
  let baseUrl: string;
  let repository: InMemoryMarketRepository;
  
  const originalRedisUrl = process.env.REDIS_URL;

  beforeAll(() => {
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    if (originalRedisUrl) {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  beforeEach(async () => {
    resetRateLimiters();
    resetSocketIpConnectionCounts();
    clearMarketState();
    clearAllSubscriptions();
    resetSequence(0);

    repository = new InMemoryMarketRepository();
    setMarketRepository(repository);

    app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use(requestTimeoutMiddleware(30000));

    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/telegram/webhook') || req.path.startsWith('/sales/ingest')) {
        return next();
      }
      return restApiRateLimiter(req, res, next);
    });

    app.post('/api/telegram/webhook', (req, res) => {
      const result = processTelegramMarketEvent(req.body);
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(400).json(result);
      }
    });

    app.get('/api/market/stats', (req, res) => {
      const snapshot = getMarketSnapshot('pepe_gift:::TON');
      res.json({ ok: true, salesCount: snapshot.recentSales.length });
    });

    server = createServer(app);
    io = new SocketIOServer(server, {
      transports: ['websocket'],
      cors: getSocketCorsOptions(),
    });

    initRealtimeManager(io);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    io.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. REST API & Ingestion High-Concurrency Load Test (500 Concurrent Requests)', async () => {
    const totalRequests = 500;
    const latencies: number[] = [];
    let successCount = 0;

    const startTime = Date.now();

    const requestPromises = Array.from({ length: totalRequests }, async (_, index) => {
      const reqStart = Date.now();
      try {
        const payload = {
          sale_id: `load_test_sale_${index}_${Date.now()}`,
          collection_id: 'pepe_gift',
          price: (100 + (index % 50)).toString(),
          currency: 'TON',
          event_time: 1710000000000 + index * 10,
          status: 'completed',
        };

        const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const reqEnd = Date.now();
        latencies.push(reqEnd - reqStart);

        if (res.status === 200) {
          successCount++;
        }
      } catch (err) {
        // failed
      }
    });

    await Promise.all(requestPromises);
    const durationMs = Date.now() - startTime;

    const metrics = calculateMetrics(latencies, durationMs, totalRequests, successCount);

    console.log(
      `[LOAD METRICS - Ingestion 500 reqs] RPS: ${metrics.rps}, p50: ${metrics.p50Ms}ms, p95: ${metrics.p95Ms}ms, p99: ${metrics.p99Ms}ms, success: ${metrics.successfulRequests}/${metrics.totalRequests}`
    );

    expect(metrics.successfulRequests).toBe(totalRequests);
    expect(metrics.rps).toBeGreaterThan(50);

    const savedSales = repository.getSales();
    expect(savedSales.length).toBe(totalRequests);
  });

  it('2. Duplicate Webhook Burst Load Test (200 Duplicate Concurrent Requests)', async () => {
    const totalRequests = 200;
    const payload = {
      sale_id: 'duplicate_burst_sale_unique_1',
      collection_id: 'pepe_gift',
      price: '300',
      currency: 'TON',
      event_time: 1710000050000,
      status: 'completed',
    };

    let processedTrueCount = 0;
    let duplicateCount = 0;

    const startTime = Date.now();

    const requestPromises = Array.from({ length: totalRequests }, async () => {
      const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 200) {
        const body = await res.json();
        if (body.processed === true) {
          processedTrueCount++;
        } else if (body.reason === 'duplicate') {
          duplicateCount++;
        }
      }
    });

    await Promise.all(requestPromises);
    const durationMs = Date.now() - startTime;

    console.log(
      `[LOAD METRICS - Duplicate Burst 200 reqs] Duration: ${durationMs}ms, Processed: ${processedTrueCount}, Rejected Duplicates: ${duplicateCount}`
    );

    expect(processedTrueCount).toBe(1);
    expect(duplicateCount).toBe(totalRequests - 1);
    expect(repository.getSales().length).toBe(1);
  });

  it('3. Socket.io Concurrent Client Connections & Subscriptions Load Test (50 Clients)', async () => {
    const clientCount = 50;
    const clients: ClientSocket[] = [];
    let connectedCount = 0;
    let snapshotReceivedCount = 0;

    const startTime = Date.now();

    const connectPromises = Array.from({ length: clientCount }, async (_, index) => {
      return new Promise<void>((resolve) => {
        const simulatedIp = `10.0.${Math.floor(index / 10)}.${index % 10}`;
        const socket = SocketIOClient(baseUrl, {
          transports: ['websocket'],
          forceNew: true,
          extraHeaders: {
            'x-forwarded-for': simulatedIp,
          },
        });

        socket.on('connect', () => {
          connectedCount++;
          socket.emit('market_subscribe', {
            collectionId: 'pepe_gift',
            currency: 'TON',
            timeframes: ['1m', '5m'],
          });
        });

        socket.on('market_event', (event: any) => {
          if (event.type === 'snapshot') {
            snapshotReceivedCount++;
            resolve();
          }
        });

        clients.push(socket);
      });
    });

    await Promise.all(connectPromises);
    const durationMs = Date.now() - startTime;

    console.log(
      `[LOAD METRICS - 50 WS Clients] Connected: ${connectedCount}, Snapshots Received: ${snapshotReceivedCount}, Duration: ${durationMs}ms`
    );

    expect(connectedCount).toBe(clientCount);
    expect(snapshotReceivedCount).toBe(clientCount);

    clients.forEach((c) => c.disconnect());
  });

  it('4. Realtime Broadcast Under Load (30 Clients receive candle_update & candle_closed simultaneously)', async () => {
    const clientCount = 30;
    const clients: ClientSocket[] = [];
    let updateEventsReceived = 0;

    await Promise.all(
      Array.from({ length: clientCount }, (_, index) => {
        return new Promise<void>((resolve) => {
          const simulatedIp = `10.1.${Math.floor(index / 10)}.${index % 10}`;
          const socket = SocketIOClient(baseUrl, {
            transports: ['websocket'],
            forceNew: true,
            extraHeaders: {
              'x-forwarded-for': simulatedIp,
            },
          });

          socket.on('connect', () => {
            socket.emit('market_subscribe', {
              collectionId: 'pepe_gift',
              currency: 'TON',
              timeframes: ['1m'],
            });
          });

          socket.on('market_event', (event: any) => {
            if (event.type === 'snapshot') {
              resolve();
            } else if (event.type === 'candle_update' || event.type === 'candle_closed') {
              updateEventsReceived++;
            }
          });

          clients.push(socket);
        });
      })
    );

    const startTime = Date.now();
    for (let i = 0; i < 10; i++) {
      acceptCompletedSale({
        id: `broadcast_load_sale_${i}`,
        collectionId: 'pepe_gift',
        currency: 'TON',
        price: (100 + i).toString(),
        quantity: 1,
        eventTime: 1710000000000 + i * 1000,
        status: 'completed',
      });
    }

    await new Promise((r) => setTimeout(r, 100));
    const durationMs = Date.now() - startTime;

    console.log(
      `[LOAD METRICS - 30 Clients Broadcast] Total Broadcast Events Received: ${updateEventsReceived}, Duration: ${durationMs}ms`
    );

    expect(updateEventsReceived).toBe(clientCount * 10);
    clients.forEach((c) => c.disconnect());
  });

  it('5. Reconnect Storm Load Test (30 Clients Disconnect and Reconnect Simultaneously)', async () => {
    const clientCount = 30;
    const clients: ClientSocket[] = [];
    let initialConnects = 0;
    let reconnectCount = 0;

    await Promise.all(
      Array.from({ length: clientCount }, (_, index) => {
        return new Promise<void>((resolve) => {
          const simulatedIp = `10.2.${Math.floor(index / 10)}.${index % 10}`;
          const socket = SocketIOClient(baseUrl, {
            transports: ['websocket'],
            forceNew: true,
            reconnection: true,
            extraHeaders: {
              'x-forwarded-for': simulatedIp,
            },
          });

          socket.on('connect', () => {
            initialConnects++;
            resolve();
          });

          clients.push(socket);
        });
      })
    );

    expect(initialConnects).toBe(clientCount);

    const reconnectStartTime = Date.now();

    const reconnectPromises = clients.map((client) => {
      return new Promise<void>((resolve) => {
        client.on('connect', () => {
          reconnectCount++;
          resolve();
        });

        client.disconnect();
        client.connect();
      });
    });

    await Promise.all(reconnectPromises);
    const reconnectDurationMs = Date.now() - reconnectStartTime;

    console.log(
      `[LOAD METRICS - Reconnect Storm 30 Clients] Reconnected: ${reconnectCount}/${clientCount}, Duration: ${reconnectDurationMs}ms`
    );

    expect(reconnectCount).toBe(clientCount);
    clients.forEach((c) => c.disconnect());
  });
});
