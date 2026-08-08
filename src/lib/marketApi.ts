export type Timeframe = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

export interface GiftCandle {
  instrumentKey: string;
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradeCount: number;
  confirmed: boolean;
  revision: number;
}

export async function fetchMarketCandles(
  instrumentKey: string,
  timeframe: Timeframe,
  from?: number,
  to?: number,
  limit: number = 500
): Promise<GiftCandle[]> {
  const url = new URL('/api/market/candles', window.location.origin);
  url.searchParams.append('instrumentKey', instrumentKey);
  url.searchParams.append('timeframe', timeframe);
  if (from) url.searchParams.append('from', from.toString());
  if (to) url.searchParams.append('to', to.toString());
  url.searchParams.append('limit', limit.toString());

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch market candles");
  const data = await res.json();
  return data.candles;
}
