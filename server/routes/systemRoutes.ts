import express from 'express';
import { getRedisHealthStatus } from '../redisManager';
import { getMarketRepository } from '../marketState';
import { isPostgresConfigured } from '../dbConfig';

const router = express.Router();

let cachedGramPrice = 5.5;
let lastGramPriceFetch = 0;

// Dynamic tonconnect-manifest.json
router.get(['/tonconnect-manifest.json', '/api/tonconnect-manifest.json'], (req, res) => {
  const referer = (req.headers['referer'] || req.headers['origin']) as string | undefined;
  let origin = '';

  if (referer && typeof referer === 'string' && referer.startsWith('http')) {
    try {
      const u = new URL(referer);
      if (u.origin && u.origin !== 'null') {
        origin = u.origin;
      }
    } catch (_) {}
  }

  if (!origin) {
    const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
      ?.split(',')[0]
      .trim();
    const hostHeader = req.get('host');
    const host = forwardedHost || hostHeader || 'localhost:3000';
    const protocol =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0].trim() === 'https' ||
      req.protocol === 'https'
        ? 'https'
        : 'http';
    origin = `${protocol}://${host}`;
  }

  if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
    if (origin.includes('localhost') && !process.env.APP_URL.includes('localhost')) {
      origin = process.env.APP_URL.replace(/\/+$/, '');
    }
  }

  res.json({
    url: origin,
    name: 'GX Exchange',
    iconUrl: 'https://telegram.org/img/t_logo.png',
    termsOfUseUrl: `${origin}/terms`,
    privacyPolicyUrl: `${origin}/privacy`,
  });
});

// Currency exchange rate (TON/USDT)
router.get(['/rates', '/api/rates'], async (req, res) => {
  const now = Date.now();
  if (now - lastGramPriceFetch > 30000) {
    try {
      const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT');
      if (response.ok) {
        const data = await response.json();
        if (data && data.price) {
          cachedGramPrice = parseFloat(data.price);
          lastGramPriceFetch = now;
        }
      }
    } catch (e) {
      console.error('Failed to fetch real-time Gram/TON rate:', e);
    }
  }
  res.json({ gram: cachedGramPrice });
});

// App configuration for frontend
router.get(['/config', '/api/config'], (req, res) => {
  res.json({
    hotWalletAddress: process.env.EXCHANGE_HOT_WALLET_ADDRESS || '',
  });
});

// Client error logging
router.post('/api/log-client-error', (req, res) => {
  console.warn('[Client Error]', req.body);
  res.status(200).json({ status: 'logged' });
});

// Health check probe
router.get(['/health', '/api/health'], (req: express.Request, res: express.Response) => {
  const redisHealth = getRedisHealthStatus();
  const repo = getMarketRepository();
  const dbConnected = isPostgresConfigured();
  const PORT = Number(process.env.PORT || 3000);

  res.status(200).json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    redis: redisHealth,
    database: {
      connected: dbConnected,
      repository: repo ? repo.constructor.name : 'Unknown',
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: PORT,
      requireRedis: process.env.REQUIRE_REDIS === 'true',
      simulationMode: process.env.SIMULATION_MODE === 'true',
      allowFileStorageInProd: process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true',
    },
  });
});

// Readiness probe
router.get(['/readiness', '/api/readiness'], (req: express.Request, res: express.Response) => {
  const requireRedis = process.env.REQUIRE_REDIS === 'true';
  const redisHealth = getRedisHealthStatus();
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDb = isPostgresConfigured();

  if (requireRedis && !redisHealth.isConnected) {
    return res.status(503).json({
      ready: false,
      reason: 'Redis is required (REQUIRE_REDIS=true) but Redis connection is inactive.',
    });
  }

  if (isProduction && !hasDb) {
    return res.status(503).json({
      ready: false,
      reason: 'PostgreSQL (DATABASE_URL) is strictly required in production.',
    });
  }

  return res.status(200).json({
    ready: true,
    timestamp: Date.now(),
    redisActive: redisHealth.isConnected,
  });
});

// Liveness probe
router.get(['/live', '/api/live'], (req: express.Request, res: express.Response) => {
  res.status(200).json({ alive: true, timestamp: Date.now() });
});

export default router;
