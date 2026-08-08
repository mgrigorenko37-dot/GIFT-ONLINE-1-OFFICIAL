import { UTCTimestamp } from 'lightweight-charts';
import { GiftCandle, Timeframe, msToSeconds } from '../types/market';

export interface FormattedChartCandle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Validates, deduplicates, sorts, and converts GiftCandle array into
 * Lightweight Charts compatible candlestick data array.
 * 
 * Rules:
 * - Checks timezone / UTC timestamp conversion (ms -> seconds).
 * - Filters out invalid candles (e.g. wrong timeframe, non-positive startTime, NaN prices).
 * - Deduplicates candles by startTime (keeps candle with highest revision/updatedAt).
 * - Sorts candles strictly by startTime ASC.
 * - Converts exact string prices to numbers at the Lightweight Charts boundary only.
 */
export function processCandlesForChart(
  candles: GiftCandle[],
  expectedTimeframe: Timeframe
): FormattedChartCandle[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }

  // Map by startTime to deduplicate
  const map = new Map<number, GiftCandle>();

  for (const c of candles) {
    if (!c || typeof c !== 'object') continue;
    
    // Strict timeframe check
    if (c.timeframe && c.timeframe !== expectedTimeframe) {
      continue;
    }

    // Check startTime
    if (typeof c.startTime !== 'number' || c.startTime <= 0 || !Number.isFinite(c.startTime)) {
      continue;
    }

    // Check string prices
    const o = parseFloat(c.open);
    const h = parseFloat(c.high);
    const l = parseFloat(c.low);
    const cl = parseFloat(c.close);

    if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(cl)) {
      continue;
    }

    // Do not display OHLC = 0 without sales
    if (o === 0 && h === 0 && l === 0 && cl === 0 && (!c.tradeCount || c.tradeCount === 0)) {
      continue;
    }

    const existing = map.get(c.startTime);
    if (!existing) {
      map.set(c.startTime, c);
    } else {
      // Keep candle with higher revision or updatedAt
      const existingRev = existing.revision ?? 0;
      const currentRev = c.revision ?? 0;
      if (currentRev > existingRev || (currentRev === existingRev && (c.updatedAt ?? 0) > (existing.updatedAt ?? 0))) {
        map.set(c.startTime, c);
      }
    }
  }

  // Sort by startTime ASC
  const sorted = Array.from(map.values()).sort((a, b) => a.startTime - b.startTime);

  // Convert to Lightweight Charts format
  return sorted.map((c) => {
    const timeInSeconds = msToSeconds(c.startTime) as UTCTimestamp;
    return {
      time: timeInSeconds,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
    };
  });
}
