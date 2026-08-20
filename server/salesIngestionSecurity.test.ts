import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import crypto from 'crypto';
import request from 'supertest';
import { validateInternalWorkerAuth } from './rateLimiter';
import { processTelegramMarketEvent } from './telegramAdapter';
import { clearMarketState } from './marketState';

describe('Sales Ingestion Security & Payload Validation', () => {
  let app: express.Express;
  const SECRET = 'test_secret_123';

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = SECRET;
    app = express();
    // Simulate body parser limits
    app.use(express.json({ limit: '100kb' }));

    app.post('/api/sales/ingest', validateInternalWorkerAuth, (req, res) => {
      const result = processTelegramMarketEvent(req.body);
      res.status(result.success ? 200 : 400).json(result);
    });
    
    clearMarketState();
  });

  afterEach(() => {
    delete process.env.INTERNAL_API_SECRET;
  });

  function signPayload(payload: any, timestamp: number, secret: string) {
    const payloadStr = JSON.stringify(payload);
    return crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${payloadStr}`)
      .digest('hex');
  }

  it('1. Rejects request without authorization headers', async () => {
    const res = await request(app).post('/api/sales/ingest').send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing signature or timestamp');
  });

  it('2. Rejects request with invalid signature (wrong secret)', async () => {
    const payload = { collection_id: 'test' };
    const ts = Date.now();
    const sig = signPayload(payload, ts, 'wrong_secret');

    const res = await request(app)
      .post('/api/sales/ingest')
      .set('x-internal-timestamp', ts.toString())
      .set('x-internal-signature', sig)
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid signature');
  });

  it('3. Rejects request with expired timestamp (replay protection)', async () => {
    const payload = { collection_id: 'test' };
    const ts = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const sig = signPayload(payload, ts, SECRET);

    const res = await request(app)
      .post('/api/sales/ingest')
      .set('x-internal-timestamp', ts.toString())
      .set('x-internal-signature', sig)
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Request expired');
  });

  it('4. Rejects excessively large payload via express limit', async () => {
    const hugePayload = { collection_id: 'test', data: 'x'.repeat(200000) }; // ~200kb
    const ts = Date.now();
    const sig = signPayload(hugePayload, ts, SECRET);

    const res = await request(app)
      .post('/api/sales/ingest')
      .set('x-internal-timestamp', ts.toString())
      .set('x-internal-signature', sig)
      .send(hugePayload);

    expect(res.status).toBe(413); // Payload Too Large
  });

  it('5. Accepts valid request', async () => {
    const payload = {
      collection_id: 'test_coll',
      price: '10',
      quantity: '1',
      event_time: Date.now(),
      transaction_hash: 'tx123',
      gift_id: 'g1'
    };
    const ts = Date.now();
    const sig = signPayload(payload, ts, SECRET);

    const res = await request(app)
      .post('/api/sales/ingest')
      .set('x-internal-timestamp', ts.toString())
      .set('x-internal-signature', sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('6. Idempotency: Rejects duplicate sale ID', async () => {
    const payload = {
      id: 'sale_unique_1',
      collection_id: 'test_coll',
      price: '10',
      quantity: '1',
      event_time: Date.now(),
    };
    const ts1 = Date.now();
    const sig1 = signPayload(payload, ts1, SECRET);

    // First request
    await request(app)
      .post('/api/sales/ingest')
      .set('x-internal-timestamp', ts1.toString())
      .set('x-internal-signature', sig1)
      .send(payload);

    // Second request with same sale ID but new timestamp/signature
    const ts2 = Date.now();
    const sig2 = signPayload(payload, ts2, SECRET);

    const res2 = await request(app)
      .post('/api/sales/ingest')
      .set('x-internal-timestamp', ts2.toString())
      .set('x-internal-signature', sig2)
      .send(payload);

    expect(res2.status).toBe(200); // the endpoint returns 200 but marks as duplicate
    expect(res2.body.success).toBe(true);
    expect(res2.body.processed).toBe(false);
    expect(res2.body.reason).toBe('duplicate');
  });

  it('7. Rejects invalid price and quantity (NaN, negative, excessive)', async () => {
    const tests = [
      { price: -1, quantity: 1, reason: 'must be a positive number' },
      { price: 10, quantity: -1, reason: 'must be a positive number' },
      { price: 'NaN', quantity: 1, reason: 'must be a positive number' },
      { price: 10, quantity: 'Infinity', reason: 'must be a positive number' },
      { price: 1e15, quantity: 1, reason: 'not exceed 1e12' },
      { price: 10, quantity: 1e13, reason: 'not exceed 1e12' },
    ];

    for (const t of tests) {
      const payload = {
        collection_id: 'test_coll',
        price: t.price,
        quantity: t.quantity,
        event_time: Date.now(),
        transaction_hash: 'tx123'
      };
      const ts = Date.now();
      const sig = signPayload(payload, ts, SECRET);

      const res = await request(app)
        .post('/api/sales/ingest')
        .set('x-internal-timestamp', ts.toString())
        .set('x-internal-signature', sig)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.reason).toContain(t.reason);
    }
  });

});
