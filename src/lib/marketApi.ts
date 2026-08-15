import { GiftCandle, Timeframe, normalizeInstrumentKey } from '../types/market';

export type { GiftCandle, Timeframe };

export async function fetchMarketCandles(
  instrumentKey: string,
  timeframe: Timeframe,
  from?: number,
  to?: number,
  limit: number = 500,
  signal?: AbortSignal
): Promise<GiftCandle[]> {
  const normKey = normalizeInstrumentKey(instrumentKey);
  const url = new URL('/api/market/candles', window.location.origin);
  url.searchParams.append('instrumentKey', normKey);
  url.searchParams.append('timeframe', timeframe);
  if (from) url.searchParams.append('from', from.toString());
  if (to) url.searchParams.append('to', to.toString());
  url.searchParams.append('limit', limit.toString());

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error('Failed to fetch market candles');
  const data = await res.json();
  return data.candles || [];
}
