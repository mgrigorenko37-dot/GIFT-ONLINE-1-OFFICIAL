import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// Setup mock config for limiters BEFORE importing the module
vi.mock('./rateLimiter', async () => {
  const actual: any = await vi.importActual('./rateLimiter');
  return {
    ...actual,
    webhookRateLimiter: actual.createRateLimiter({
      windowMs: 1000, // 1 second for test speed
      max: 2, // Max 2 requests per second
      prefix: 'test-webhook',
    })
  }
});

import { webhookRateLimiter, resetRateLimiters } from './rateLimiter';

const app = express();
app.use('/webhook', webhookRateLimiter, (req, res) => {
  res.json({ ok: true });
});

describe('Webhook Rate Limiting', () => {
  beforeEach(() => {
    resetRateLimiters();
  });

  it('should allow requests under the limit', async () => {
    const res1 = await request(app).post('/webhook').send({});
    expect(res1.status).toBe(200);

    const res2 = await request(app).post('/webhook').send({});
    expect(res2.status).toBe(200);
  });

  it('should block requests over the limit and return 429', async () => {
    await request(app).post('/webhook').send({});
    await request(app).post('/webhook').send({});
    
    const res3 = await request(app).post('/webhook').send({});
    expect(res3.status).toBe(429);
    expect(res3.body.error).toContain('Too many requests');
  });

  it('should reset limit after window time', async () => {
    await request(app).post('/webhook').send({});
    await request(app).post('/webhook').send({});
    
    let res3 = await request(app).post('/webhook').send({});
    expect(res3.status).toBe(429);

    // Wait for the sliding window to pass
    await new Promise(r => setTimeout(r, 1100));

    res3 = await request(app).post('/webhook').send({});
    expect(res3.status).toBe(200);
  });
});
