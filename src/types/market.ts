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

export const VALID_CURRENCIES = new Set<string>(['TON', 'STARS', 'Gram']);

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
  transactionHash?: string;
}

export interface GiftCandle {
  instrumentKey: string;
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  time?: number;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
  quoteVolume?: number | string;
  sumQuote?: number | string;
  sumQuantity?: number | string;
  itemCount?: number | string;
  tradeCount?: number;
  firstSaleId?: string;
  firstSaleTime?: number;
  lastSaleId?: string;
  lastSaleTime?: number;
  confirmed?: boolean;
  revision?: number;
  updatedAt?: number;
}

export interface ParsedInstrumentKey {
  collectionId: string;
  modelId?: string;
  backdropId?: string;
  currency: Currency;
}

export function buildInstrumentKey(parsed: ParsedInstrumentKey): string {
  if (
    !parsed ||
    !parsed.collectionId ||
    typeof parsed.collectionId !== 'string' ||
    !parsed.collectionId.trim()
  ) {
    throw new Error('collectionId must be a non-empty string');
  }
  if (!parsed.currency || !VALID_CURRENCIES.has(parsed.currency)) {
    throw new Error(`Invalid currency: ${parsed.currency}`);
  }
  const model = parsed.modelId !== undefined && parsed.modelId !== '' ? parsed.modelId : 'all';
  const backdrop =
    parsed.backdropId !== undefined && parsed.backdropId !== '' ? parsed.backdropId : 'all';
  return `${parsed.collectionId}:${model}:${backdrop}:${parsed.currency}`;
}

export function parseInstrumentKey(instrumentKey: string): ParsedInstrumentKey {
  if (!instrumentKey || typeof instrumentKey !== 'string') {
    throw new Error('instrumentKey must be a non-empty string');
  }
  const parts = instrumentKey.split(':');
  if (parts.length !== 4) {
    return {
      collectionId: instrumentKey,
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
    };
  }
  const [rawCollection, rawModel, rawBackdrop, rawCurrency] = parts;
  return {
    collectionId: rawCollection,
    modelId: rawModel || 'all',
    backdropId: rawBackdrop || 'all',
    currency: (rawCurrency as Currency) || 'TON',
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
  return buildInstrumentKey({
    collectionId: trimmed,
    modelId: 'all',
    backdropId: 'all',
    currency: defaultCurrency,
  });
}

export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export type ListingStatus = 'active' | 'sold' | 'cancelled' | 'expired';

export interface GiftListing {
  listingId: string;
  instrumentKey: string;
  collectionId: string;
  modelId: string;
  backdropId: string;
  giftId?: string;
  price: string;
  currency: Currency;
  sellerId?: string;
  status: ListingStatus;
  createdAt: number;
  updatedAt: number;
}

export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}
