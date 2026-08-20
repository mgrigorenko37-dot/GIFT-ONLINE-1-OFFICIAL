import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { isRedisActive, getPubClient } from './redisManager';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  prefix: string;
  message?: string;
}

interface MemoryRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, MemoryRecord>();

export function resetRateLimiters(): void {
  memoryStore.clear();
}

/**
 * Checks rate limit for a given key using Redis (if active) or in-memory sliding window fallback.
 */
export async function checkRateLimitKey(
  key: string,
  max: number,
  windowMs: number
): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetMs: number;
}> {
  const now = Date.now();

  if (isRedisActive()) {
    const pub = getPubClient();
    if (pub) {
      try {
        const redisKey = `rl:${key}`;
        const count = await pub.incr(redisKey);
        if (count === 1) {
          const ttlSeconds = Math.ceil(windowMs / 1000);
          await pub.expire(redisKey, ttlSeconds);
        }
        const ttl = await pub.ttl(redisKey);
        const resetMs = ttl > 0 ? ttl * 1000 : windowMs;
        const allowed = count <= max;

        return {
          allowed,
          current: count,
          limit: max,
          remaining: Math.max(0, max - count),
          resetMs,
        };
      } catch (err) {
        console.warn('[RateLimiter] Redis error, falling back to memory store:', err);
      }
    }
  }

  // Memory fallback
  const record = memoryStore.get(key);
  if (!record || now >= record.resetAt) {
    const newRecord: MemoryRecord = {
      count: 1,
      resetAt: now + windowMs,
    };
    memoryStore.set(key, newRecord);
    return {
      allowed: true,
      current: 1,
      limit: max,
      remaining: max - 1,
      resetMs: windowMs,
    };
  }

  record.count += 1;
  const allowed = record.count <= max;
  const resetMs = record.resetAt - now;

  return {
    allowed,
    current: record.count,
    limit: max,
    remaining: Math.max(0, max - record.count),
    resetMs,
  };
}

/**
 * Express Middleware Factory for Rate Limiting
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { windowMs, max, prefix, message = 'Too many requests, please try again later.' } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown_ip';
    const key = `${prefix}:${clientIp}`;

    try {
      const result = await checkRateLimitKey(key, max, windowMs);
      res.setHeader('X-RateLimit-Limit', result.limit.toString());
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader(
        'X-RateLimit-Reset',
        Math.ceil((Date.now() + result.resetMs) / 1000).toString()
      );

      if (!result.allowed) {
        console.warn(
          `[RateLimiter] Blocked rate limit burst from IP ${clientIp} on path ${req.path} (${prefix})`
        );
        return res
          .status(429)
          .json({ error: message, retryAfterSeconds: Math.ceil(result.resetMs / 1000) });
      }

      next();
    } catch (err) {
      console.error('[RateLimiter] Error evaluating rate limit:', err);
      next();
    }
  };
}

/**
 * Pre-configured rate limiters
 */
export const webhookRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  prefix: 'webhook',
  message: 'Rate limit exceeded for Telegram Webhook ingestion.',
});

export const restApiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  prefix: 'rest',
  message: 'Rate limit exceeded for REST API endpoints.',
});

/**
 * Internal Worker Authentication
 */
export function validateInternalWorkerAuth(req: Request, res: Response, next: NextFunction) {
  const secretEnv = process.env.INTERNAL_API_SECRET;
  if (!secretEnv || secretEnv.trim() === '') {
    return res.status(500).json({ error: 'Server configuration error: INTERNAL_API_SECRET not set' });
  }

  const signature = req.headers['x-internal-signature'] as string;
  const timestampStr = req.headers['x-internal-timestamp'] as string;

  if (!signature || !timestampStr) {
    return res.status(401).json({ error: 'Unauthorized: Missing signature or timestamp' });
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid timestamp format' });
  }

  // Replay protection: 5 minutes tolerance
  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'Unauthorized: Request expired (replay protection)' });
  }

  // Calculate HMAC signature
  const payloadStr = JSON.stringify(req.body || {});
  const expectedHmac = crypto.createHmac('sha256', secretEnv)
    .update(`${timestamp}.${payloadStr}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedHmac);
  const providedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    console.warn(`[Security] Unauthorized internal API access attempt on ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
  }

  next();
}

/**
 * Telegram Webhook Secret Token / Header Validation
 */
export function validateTelegramWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const secretEnv = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_SECRET_TOKEN;

  if (!secretEnv || secretEnv.trim() === '') {
    return next();
  }

  const tokenFromHeader = (req.headers['x-telegram-bot-api-secret-token'] as string) || '';

  const expectedBuffer = Buffer.from(secretEnv);
  const providedBuffer = Buffer.from(tokenFromHeader);

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown_ip';

    console.warn(
      `[Security] Unauthorized webhook access attempt from IP ${clientIp} on path ${req.path}`
    );

    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing Telegram Webhook secret token.',
    });
  }

  next();
}

/**
 * Request Timeout Middleware
 */
export function requestTimeoutMiddleware(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        res.status(503).json({ error: 'Service Unavailable: Request Timeout' });
      }
    });
    next();
  };
}
