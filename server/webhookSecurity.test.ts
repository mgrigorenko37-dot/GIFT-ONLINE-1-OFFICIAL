import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

import { validateTelegramWebhookSecret } from './rateLimiter';

const app = express();
app.use('/webhook', validateTelegramWebhookSecret, (req, res) => {
  res.json({ ok: true });
});

describe('Webhook Security', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should allow request with correct secret token', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my_secure_secret_123';

    const res = await request(app)
      .post('/webhook')
      .set('x-telegram-bot-api-secret-token', 'my_secure_secret_123')
      .send({});

    expect(res.status).toBe(200);
  });

  it('should block request with incorrect secret token', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my_secure_secret_123';

    const res = await request(app)
      .post('/webhook')
      .set('x-telegram-bot-api-secret-token', 'attacker_token')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('should block request without secret token', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my_secure_secret_123';

    const res = await request(app).post('/webhook').send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('in production: block request if server is missing secret token config', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_SECRET_TOKEN;

    const res = await request(app)
      .post('/webhook')
      .set('x-telegram-bot-api-secret-token', 'any')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('misconfiguration');
  });
});
