import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

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
  // Payload should be stringified body. To ensure exact match, we can use raw body or just sign timestamp + body
  // Since Express parses JSON, stringifying it might reorder keys. A common practice is timestamp + '.' + stringified body
  const payloadStr = JSON.stringify(req.body || {});
  const expectedHmac = crypto.createHmac('sha256', secretEnv)
    .update(`${timestamp}.${payloadStr}`)
    .digest('hex');

  // Timing safe comparison
  const expectedBuffer = Buffer.from(expectedHmac);
  const providedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    console.warn(`[Security] Unauthorized internal API access attempt on ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
  }

  next();
}
