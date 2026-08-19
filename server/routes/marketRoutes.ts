import express from 'express';
import { handleGetCandles } from '../candlesHandler';
import { getFloorPrice, addListing, updateListingPrice, cancelListing, sellListing } from '../floorManager';
import { getMarketStats } from '../marketStats';
import { getIndicators } from '../indicatorEngine';
import { processTelegramMarketEvent } from '../telegramAdapter';
import { webhookRateLimiter, validateTelegramWebhookSecret } from '../rateLimiter';
import { getPgPool } from '../marketRepository';
import { gifts as hardcodedGifts } from '../../src/data/gifts';

const router = express.Router();

// Webhook / Sales Ingestion
router.post(
  '/telegram/webhook',
  webhookRateLimiter,
  validateTelegramWebhookSecret,
  (req: express.Request, res: express.Response) => {
    const result = processTelegramMarketEvent(req.body);
    return res.status(result.success ? 200 : 400).json(result);
  }
);

router.post(
  '/sales/ingest',
  webhookRateLimiter,
  validateTelegramWebhookSecret,
  (req: express.Request, res: express.Response) => {
    const result = processTelegramMarketEvent(req.body);
    return res.status(result.success ? 200 : 400).json(result);
  }
);

// Candles
router.get('/market/candles', handleGetCandles);

// Floor Price
router.get('/market/floor', (req: express.Request, res: express.Response) => {
  const rawKey = (
    req.query.instrumentKey ||
    req.query.key ||
    req.query.collectionId ||
    ''
  ).toString();
  if (!rawKey || rawKey.trim() === '') {
    return res.status(400).json({ error: 'instrumentKey is required' });
  }

  const rawCurr = (req.query.currency || 'TON').toString();
  try {
    const floorResult = getFloorPrice(rawKey, rawCurr as any);
    return res.json({
      instrumentKey: floorResult.instrumentKey,
      currency: floorResult.currency,
      floorPrice: floorResult.floorPrice,
      listedCount: floorResult.listedCount,
      updatedAt: floorResult.updatedAt,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Invalid instrumentKey' });
  }
});

// Market Stats
router.get('/market/stats', (req: express.Request, res: express.Response) => {
  const rawKey = (
    req.query.instrumentKey ||
    req.query.key ||
    req.query.collectionId ||
    ''
  ).toString();
  if (!rawKey || rawKey.trim() === '') {
    return res.status(400).json({ error: 'instrumentKey is required' });
  }

  const currency = (req.query.currency || 'TON').toString();
  const timeframe = req.query.timeframe ? req.query.timeframe.toString() : undefined;

  const fromNum = req.query.from !== undefined ? Number(req.query.from) : undefined;
  const toNum = req.query.to !== undefined ? Number(req.query.to) : undefined;

  const from = typeof fromNum === 'number' && !isNaN(fromNum) ? fromNum : undefined;
  const to = typeof toNum === 'number' && !isNaN(toNum) ? toNum : undefined;

  try {
    const stats = getMarketStats({
      instrumentKey: rawKey,
      currency: currency as any,
      timeframe,
      from,
      to,
    });
    return res.json(stats);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to compute market stats' });
  }
});

// Indicators
router.get('/market/indicators', (req: express.Request, res: express.Response) => {
  const rawKey = (
    req.query.instrumentKey ||
    req.query.key ||
    req.query.collectionId ||
    ''
  ).toString();
  if (!rawKey || rawKey.trim() === '') {
    return res.status(400).json({ error: 'instrumentKey is required' });
  }

  const currency = (req.query.currency || 'TON').toString();
  const timeframe = (req.query.timeframe || '1m').toString() as any;
  const indicator = (req.query.indicator || 'sma').toString().toLowerCase() as any;
  const source = (req.query.source || 'close').toString().toLowerCase() as any;

  const period = req.query.period ? Number(req.query.period) : undefined;
  const fastPeriod = req.query.fastPeriod ? Number(req.query.fastPeriod) : undefined;
  const slowPeriod = req.query.slowPeriod ? Number(req.query.slowPeriod) : undefined;
  const signalPeriod = req.query.signalPeriod ? Number(req.query.signalPeriod) : undefined;

  const fromNum = req.query.from !== undefined ? Number(req.query.from) : undefined;
  const toNum = req.query.to !== undefined ? Number(req.query.to) : undefined;

  const from = typeof fromNum === 'number' && !isNaN(fromNum) ? fromNum : undefined;
  const to = typeof toNum === 'number' && !isNaN(toNum) ? toNum : undefined;

  try {
    const result = getIndicators({
      instrumentKey: rawKey,
      currency: currency as any,
      timeframe,
      indicator,
      source,
      period,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      from,
      to,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to compute indicators' });
  }
});

// Listings
router.post('/market/listings', (req: express.Request, res: express.Response) => {
  const result = addListing(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(201).json(result);
});

router.patch('/market/listings/:id/price', (req: express.Request, res: express.Response) => {
  const { price } = req.body;
  const result = updateListingPrice(String(req.params.id), price);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result);
});

router.post('/market/listings/:id/cancel', (req: express.Request, res: express.Response) => {
  const result = cancelListing(String(req.params.id));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result);
});

router.post('/market/listings/:id/sell', (req: express.Request, res: express.Response) => {
  const result = sellListing(String(req.params.id));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result);
});

// Collections (Postgres Source of Truth)
router.get(['/collections', '/gifts'], async (req: express.Request, res: express.Response) => {
  try {
    const client = await getPgPool().connect();
    const result = await client.query(
      'SELECT id, name, total_supply, image_url, floor_price_gx, created_at FROM gift_collections'
    );
    client.release();

    const mapped = result.rows.map((r) => {
      const fallback = hardcodedGifts.find((g) => g.id === r.id);
      return {
        id: r.id,
        name: r.name,
        collection: 'Telegram Gifts',
        rarity: fallback ? fallback.rarity : 'Common',
        floor: Number(r.floor_price_gx) || (fallback ? fallback.floor : 0),
        change: fallback ? fallback.change : 0,
        volume: fallback ? fallback.volume : '0',
        className: fallback ? fallback.className : 'gx-gift-box',
        emoji: fallback ? fallback.emoji : undefined,
        image_url: r.image_url || (fallback ? fallback.image_url : undefined),
        is_nft: true,
        source: 'postgres',
      };
    });
    res.json(mapped);
  } catch (error) {
    console.error('Error fetching gifts:', error);
    res.status(500).json({ error: String(error) });
  }
});

export default router;
