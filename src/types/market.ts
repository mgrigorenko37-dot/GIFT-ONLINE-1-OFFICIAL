
/**
 * Unified Market Data Types and Instrument Key Utilities
 */

export type Currency = 'TON' | 'STARS' | 'Gram';
export type Timeframe = '1s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';

export const VALID_TIMEFRAMES: Timeframe[] = [
  '1s',
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
  '1w',
  '1M',
];

export interface GiftSale {
  id: string;
  collectionId: string;
  instrumentKey?: string;
  giftId?: string;
  modelId?: string;
  backdropId?: string;
  symbol?: string;
  source?: string;
  price: string;
  currency: Currency;
  quantity: string | number;
  eventTime: number; 
  createdAt?: number; 
  timestamp?: number;
  sellerId?: string;
  buyerId?: string;
  status: string;
  isMock?: boolean;
  isSimulation?: boolean;
}

export interface GiftCandle {
  instrumentKey: string;
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  sumQuote: number;
  sumQuantity: number;
  itemCount: number;
  tradeCount: number;
  firstSaleId?: string;
  lastSaleId?: string;
  confirmed: boolean;
  revision: number;
  updatedAt: number;
}

export interface ParsedInstrumentKey {
  collectionId: string;
  modelId: string;
  backdropId: string;
  currency: Currency;
}

export function buildInstrumentKey(parsed: ParsedInstrumentKey): string {
  return `${parsed.collectionId}:${parsed.modelId}:${parsed.backdropId}:${parsed.currency}`;
}

export function parseInstrumentKey(instrumentKey: string): ParsedInstrumentKey {
  if (!instrumentKey || typeof instrumentKey !== 'string') {
    throw new Error('instrumentKey must be a non-empty string');
  }
  const parts = instrumentKey.split(':');
  if (parts.length !== 4) {
    return {
      collectionId: instrumentKey,
      modelId: 'classic',
      backdropId: 'default',
      currency: 'TON',
    };
  }
  const [rawCollection, rawModel, rawBackdrop, rawCurrency] = parts;
  return {
    collectionId: rawCollection,
    modelId: rawModel,
    backdropId: rawBackdrop,
    currency: rawCurrency as Currency,
  };
}

export function normalizeInstrumentKey(
  instrumentKey: string,
  defaultCurrency: Currency = 'TON'
): string {
  if (!instrumentKey) return '';
  const trimmed = instrumentKey.trim();
  if (trimmed.includes(':')) {
    try {
      const parsed = parseInstrumentKey(trimmed);
      return buildInstrumentKey(parsed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}
