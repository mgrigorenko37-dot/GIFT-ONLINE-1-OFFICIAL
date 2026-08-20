import { Request, Response } from 'express';
import { getMarketCandlesHistory } from './marketState';
import { parseInstrumentKey, buildInstrumentKey, Currency, Timeframe } from '../src/types/market';

export const VALID_TIMEFRAMES = new Set<Timeframe>([
  '1s',
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
  '1w',
  '1M',
]);

export const VALID_CURRENCIES = new Set<Currency>(['TON', 'STARS']);

export async function handleGetCandles(req: Request, res: Response) {
  try {
    const rawKey = req.query.instrumentKey ? String(req.query.instrumentKey).trim() : '';
    const rawCol = req.query.collectionId ? String(req.query.collectionId).trim() : '';
    const rawModel = req.query.modelId ? String(req.query.modelId).trim() : '';
    const rawBackdrop = req.query.backdropId ? String(req.query.backdropId).trim() : '';
    const rawCurr = req.query.currency ? String(req.query.currency).trim() : '';
    const rawTf = req.query.timeframe ? String(req.query.timeframe).trim() : '';

    // 1. Timeframe Validation
    if (!rawTf || !VALID_TIMEFRAMES.has(rawTf as Timeframe)) {
      return res
        .status(400)
        .json({ error: 'Invalid timeframe. Allowed: 1s, 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M' });
    }
    const timeframe = rawTf as Timeframe;

    // 2. InstrumentKey and Parameters Resolution & Consistency Check
    let normKey = '';
    if (rawKey) {
      if (rawKey.split(':').length !== 4) {
        return res.status(400).json({
          error: 'Invalid instrumentKey format. Expected collection:model:backdrop:currency',
        });
      }
      // Validate format of rawKey
      let parsed;
      try {
        parsed = parseInstrumentKey(rawKey);
      } catch (err: any) {
        return res.status(400).json({ error: err.message || 'Invalid instrumentKey format' });
      }

      // Check parameter consistency if individual fields are passed
      if (rawCol && rawCol !== parsed.collectionId) {
        return res.status(400).json({
          error: `Parameter mismatch: collectionId "${rawCol}" does not match instrumentKey collectionId "${parsed.collectionId}"`,
        });
      }

      if (rawModel) {
        const normModel = rawModel === 'any' || rawModel === 'all' ? 'all' : rawModel;
        if (normModel !== parsed.modelId) {
          return res.status(400).json({
            error: `Parameter mismatch: modelId "${rawModel}" does not match instrumentKey modelId "${parsed.modelId}"`,
          });
        }
      }

      if (rawBackdrop) {
        const normBackdrop = rawBackdrop === 'any' || rawBackdrop === 'all' ? 'all' : rawBackdrop;
        if (normBackdrop !== parsed.backdropId) {
          return res.status(400).json({
            error: `Parameter mismatch: backdropId "${rawBackdrop}" does not match instrumentKey backdropId "${parsed.backdropId}"`,
          });
        }
      }

      if (rawCurr && rawCurr !== parsed.currency) {
        return res.status(400).json({
          error: `Parameter mismatch: currency "${rawCurr}" does not match instrumentKey currency "${parsed.currency}"`,
        });
      }

      normKey = buildInstrumentKey(parsed);
    } else {
      // Missing instrumentKey: require collectionId
      if (!rawCol) {
        return res
          .status(400)
          .json({ error: 'Missing required parameter: instrumentKey or collectionId is required' });
      }

      const currToUse = rawCurr || 'TON';
      if (!VALID_CURRENCIES.has(currToUse as Currency)) {
        return res
          .status(400)
          .json({ error: `Invalid currency: "${currToUse}". Allowed: TON, STARS` });
      }

      try {
        normKey = buildInstrumentKey({
          collectionId: rawCol,
          modelId: rawModel,
          backdropId: rawBackdrop,
          currency: currToUse as Currency,
        });
      } catch (err: any) {
        return res.status(400).json({ error: err.message || 'Invalid instrument parameters' });
      }
    }

    // 3. Timestamps (from / to) Validation
    let from: number | undefined;
    let to: number | undefined;

    if (req.query.from !== undefined) {
      const fNum = Number(req.query.from);
      if (isNaN(fNum) || !isFinite(fNum) || fNum < 0) {
        return res.status(400).json({ error: 'Invalid from timestamp' });
      }
      if (fNum > 0 && fNum < 100000000000) {
        return res
          .status(400)
          .json({ error: 'from timestamp must be in milliseconds, not seconds' });
      }
      from = fNum;
    }

    if (req.query.to !== undefined) {
      const tNum = Number(req.query.to);
      if (isNaN(tNum) || !isFinite(tNum) || tNum < 0) {
        return res.status(400).json({ error: 'Invalid to timestamp' });
      }
      if (tNum > 0 && tNum < 100000000000) {
        return res.status(400).json({ error: 'to timestamp must be in milliseconds, not seconds' });
      }
      to = tNum;
    }

    if (from !== undefined && to !== undefined && from > to) {
      return res.status(400).json({ error: 'from timestamp cannot be greater than to timestamp' });
    }

    // 4. Limit Validation
    let limit: number | undefined;
    if (req.query.limit !== undefined) {
      const lNum = Number(req.query.limit);
      if (isNaN(lNum) || !Number.isInteger(lNum) || lNum <= 0) {
        return res.status(400).json({ error: 'limit must be a positive integer' });
      }
      limit = lNum;
    }

    // 5. Cursor Validation
    let cursor: string | undefined;
    if (req.query.cursor !== undefined) {
      const cStr = String(req.query.cursor).trim();
      const cNum = Number(cStr);
      if (isNaN(cNum) || cNum < 0) {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
      if (cNum > 0 && cNum < 100000000000) {
        return res.status(400).json({ error: 'cursor timestamp must be in milliseconds' });
      }
      cursor = cStr;
    }

    // 6. Fetch Candle History
    const history = getMarketCandlesHistory(normKey, timeframe, {
      from,
      to,
      limit,
      cursor,
    });

    return res.json(history);
  } catch (error: any) {
    console.error('Error in GET /api/market/candles:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
