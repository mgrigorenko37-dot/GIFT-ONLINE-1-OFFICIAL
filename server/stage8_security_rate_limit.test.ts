import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as SocketIOClient } from 'socket.io-client';
import {
  createRateLimiter,
  resetRateLimiters,
  validateTelegramWebhookSecret,
  webhookRateLimiter,
  restApiRateLimiter,
  requestTimeoutMiddleware,
} from './rateLimiter';
import {
  handleSubscribe,
  MAX_SUBSCRIPTIONS_PER_SOCKET,
  MAX_SOCKET_CONNECTIONS_PER_IP,
  checkSocketIpConnection,
  releaseSocketIpConnection,
  resetSocketIpConnectionCounts,
  clearSocketSubscriptions,
} from './realtimeManager';
import { processTelegramMarketEvent } from './telegramAdapter';
import { clearMarketState } from './marketState';

describe('Stage 8: Security, Rate Limiting & Webhook Protection', () => {
  let app: express.Express;
  let server: HttpServer;
  let baseUrl: string;

  beforeEach(async () => {
    resetRateLimiters();
    resetSocketIpConnectionCounts();
    clearSocketSubscriptions();
    clearMarketState();
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_SECRET_TOKEN;

    app = express();
    app.use(corsMiddleware);
    app.use(express.json({ limit: '100kb' }));
    app.use(requestTimeoutMiddleware(30000));

    // Custom router structure matching production server
    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/telegram/webhook') || req.path.startsWith('/sales/ingest')) {
        return next();
      }
      return restApiRateLimiter(req, res, next);
    });

    app.post(
      '/api/telegram/webhook',
      webhookRateLimiter,
      validateTelegramWebhookSecret,
      (req, res) => {
        const result = processTelegramMarketEvent(req.body);
        if (result.success) {
          return res.status(200).json(result);
        } else {
          return res.status(400).json(result);
        }
      }
    );

    app.get('/api/market/stats', (req, res) => {
      res.json({ ok: true });
    });

    // 413 error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res
          .status(413)
          .json({ error: 'Payload Too Large: Maximum JSON payload size is 100kb.' });
      }
      next(err);
    });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_SECRET_TOKEN;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function corsMiddleware(req: any, res: any, next: any) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  }

  it('1. Requests within rate limit pass successfully', async () => {
    const res = await fetch(`${baseUrl}/api/market/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('2. Requests exceeding rate limit are blocked with 429 Too Many Requests', async () => {
    const customApp = express();
    const strictLimiter = createRateLimiter({
      windowMs: 10000,
      max: 3,
      prefix: 'strict_test',
    });
    customApp.get('/test', strictLimiter, (req, res) => res.json({ ok: true }));

    const testServer = createServer(customApp);
    await new Promise<void>((r) => testServer.listen(0, '127.0.0.1', r));
    const testPort = (testServer.address() as any).port;

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${testPort}/test`);
      expect(res.status).toBe(200);
    }

    // 4th request should be blocked
    const resBlocked = await fetch(`http://127.0.0.1:${testPort}/test`);
    expect(resBlocked.status).toBe(429);
    const body = await resBlocked.json();
    expect(body.error).toContain('Too many requests');

    await new Promise<void>((r) => testServer.close(() => r()));
  });

  it('3. Webhook and REST API rate limits are separated', async () => {
    const customApp = express();
    const webhookLimiter = createRateLimiter({ windowMs: 10000, max: 2, prefix: 'webhook_sep' });
    const restLimiter = createRateLimiter({ windowMs: 10000, max: 5, prefix: 'rest_sep' });

    customApp.use(express.json());
    customApp.post('/webhook', webhookLimiter, (req, res) => res.json({ webhook: true }));
    customApp.get('/rest', restLimiter, (req, res) => res.json({ rest: true }));

    const testServer = createServer(customApp);
    await new Promise<void>((r) => testServer.listen(0, '127.0.0.1', r));
    const testPort = (testServer.address() as any).port;

    // Exhaust webhook limit (2 reqs)
    await fetch(`http://127.0.0.1:${testPort}/webhook`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    await fetch(`http://127.0.0.1:${testPort}/webhook`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    const blockedWebhook = await fetch(`http://127.0.0.1:${testPort}/webhook`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(blockedWebhook.status).toBe(429);

    // REST endpoint should STILL work fine!
    const restRes = await fetch(`http://127.0.0.1:${testPort}/rest`);
    expect(restRes.status).toBe(200);

    await new Promise<void>((r) => testServer.close(() => r()));
  });

  it('4. Duplicate webhook is not processed twice (idempotent deduplication)', async () => {
    const payload = {
      sale_id: 'sale_stage8_dedupe_100',
      collection_id: 'pepe_gift',
      price: '150',
      currency: 'TON',
      event_time: Date.now(),
      status: 'completed',
    };

    const res1 = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.processed).toBe(true);

    // Resend identical payload
    const res2 = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res2.status).toBe(200); // 200 OK for Telegram Webhook idempotency
    const body2 = await res2.json();
    expect(body2.processed).toBe(false);
    expect(body2.reason).toBe('duplicate');
  });

  it('5. Payload exceeding 100kb size limit is rejected with 413 Payload Too Large', async () => {
    const hugeData = 'x'.repeat(110 * 1024); // ~110 KB
    const hugePayload = JSON.stringify({ data: hugeData });

    const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugePayload,
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain('Payload Too Large');
  });

  it('6. Webhook with invalid or missing secret header is rejected with 401 Unauthorized when secret is enabled', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my_super_secret_token_123';

    const payload = {
      sale_id: 'sale_sec_test_1',
      collection_id: 'pepe_gift',
      price: '100',
      currency: 'TON',
      event_time: Date.now(),
    };

    // Missing secret header
    const resMissing = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(resMissing.status).toBe(401);
    const bodyMissing = await resMissing.json();
    expect(bodyMissing.error).toContain('Unauthorized');

    // Invalid secret header
    const resInvalid = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong_secret',
      },
      body: JSON.stringify(payload),
    });
    expect(resInvalid.status).toBe(401);
  });

  it('7. Normal Telegram event with valid secret token passes successfully', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my_super_secret_token_123';

    const payload = {
      sale_id: 'sale_sec_test_valid_101',
      collection_id: 'pepe_gift',
      price: '100',
      currency: 'TON',
      event_time: Date.now(),
    };

    const resValid = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'my_super_secret_token_123',
      },
      body: JSON.stringify(payload),
    });

    expect(resValid.status).toBe(200);
    const body = await resValid.json();
    expect(body.success).toBe(true);
    expect(body.processed).toBe(true);
  });

  it('8. Rate limit resets after window expires', async () => {
    const customApp = express();
    const shortLimiter = createRateLimiter({ windowMs: 100, max: 1, prefix: 'reset_test' });
    customApp.get('/short', shortLimiter, (req, res) => res.json({ ok: true }));

    const testServer = createServer(customApp);
    await new Promise<void>((r) => testServer.listen(0, '127.0.0.1', r));
    const testPort = (testServer.address() as any).port;

    // 1st request -> ok
    const res1 = await fetch(`http://127.0.0.1:${testPort}/short`);
    expect(res1.status).toBe(200);

    // 2nd request immediately -> blocked
    const res2 = await fetch(`http://127.0.0.1:${testPort}/short`);
    expect(res2.status).toBe(429);

    // Wait 150ms for window expiration
    await new Promise((r) => setTimeout(r, 150));

    // 3rd request after window reset -> allowed again!
    const res3 = await fetch(`http://127.0.0.1:${testPort}/short`);
    expect(res3.status).toBe(200);

    await new Promise<void>((r) => testServer.close(() => r()));
  });

  it('9. Burst of rapid requests is blocked immediately by rate limiter', async () => {
    const customApp = express();
    const burstLimiter = createRateLimiter({ windowMs: 10000, max: 5, prefix: 'burst_test' });
    customApp.get('/burst', burstLimiter, (req, res) => res.json({ ok: true }));

    const testServer = createServer(customApp);
    await new Promise<void>((r) => testServer.listen(0, '127.0.0.1', r));
    const testPort = (testServer.address() as any).port;

    const promises = Array.from({ length: 10 }, () => fetch(`http://127.0.0.1:${testPort}/burst`));
    const responses = await Promise.all(promises);

    const statuses = responses.map((r) => r.status);
    const passed = statuses.filter((s) => s === 200).length;
    const blocked = statuses.filter((s) => s === 429).length;

    expect(passed).toBe(5);
    expect(blocked).toBe(5);

    await new Promise<void>((r) => testServer.close(() => r()));
  });

  it('10. Socket.io subscription limit per socket is enforced at MAX_SUBSCRIPTIONS_PER_SOCKET (50)', () => {
    const mockSocket = {
      id: 'test_socket_sub_limit_1',
      emit: () => {},
      join: () => {},
    };

    // Subscribe to 50 distinct instruments
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_SOCKET; i++) {
      const res = handleSubscribe(mockSocket, {
        collectionId: `collection_item_${i}`,
        currency: 'TON',
      });
      expect(res.success).toBe(true);
    }

    // 51st subscription should be blocked with maximum subscription limit error
    const res51 = handleSubscribe(mockSocket, {
      collectionId: `collection_item_excess_51`,
      currency: 'TON',
    });
    expect(res51.success).toBe(false);
    expect(res51.error).toContain('Maximum subscription limit reached');
  });

  it('11. Socket.io connection limit per IP is enforced at MAX_SOCKET_CONNECTIONS_PER_IP (20)', () => {
    const testIp = '192.168.1.100';

    for (let i = 0; i < MAX_SOCKET_CONNECTIONS_PER_IP; i++) {
      const allowed = checkSocketIpConnection(testIp);
      expect(allowed).toBe(true);
    }

    // 21st connection attempt from same IP should be blocked
    const blocked = checkSocketIpConnection(testIp);
    expect(blocked).toBe(false);

    // After 1 connection disconnects, IP is allowed to connect 1 more
    releaseSocketIpConnection(testIp);
    const allowedAfterDisconnect = checkSocketIpConnection(testIp);
    expect(allowedAfterDisconnect).toBe(true);
  });
});
