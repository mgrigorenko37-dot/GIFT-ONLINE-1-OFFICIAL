import Decimal from 'decimal.js';
import { GiftSale, getInstrumentKey } from './chartEngine';
import { allSales } from './marketState';
import { getFloorPrice } from './floorManager';
import { normalizeInstrumentKey, parseInstrumentKey, Currency } from '../src/types/market';

export interface MarketStatsOptions {
  instrumentKey: string;
  currency?: Currency;
  timeframe?: string;
  from?: number; // timestamp in ms (inclusive)
  to?: number; // timestamp in ms (exclusive)
}

export interface MarketStatsResult {
  instrumentKey: string;
  currency: Currency;
  timeframe?: string;
  from?: number;
  to?: number;
  lastSalePrice: string | null;
  lastSaleTime: number | null;
  floorPrice: string | null;
  listedCount: number;
  averageSalePrice: string | null;
  salesCount: number;
  volume: string | null;
  quoteVolume: string | null;
  priceChange: string | null;
  priceChangePercent: string | null;
  supply: number | null;
  updatedAt: number;
}

/**
 * BASELINE RULE SPECIFICATION FOR PRICE CHANGE:
 * The baseline price for calculating `priceChange` and `priceChangePercent` is defined as
 * the price of the FIRST completed sale within the requested period/time range (from-to).
 *
 * - If 0 completed sales exist in the period: priceChange = null, priceChangePercent = null.
 * - If 1 completed sale exists in the period: priceChange = "0", priceChangePercent = "0".
 * - If >1 completed sales exist in the period:
 *     priceChange = Decimal(lastSalePrice) - Decimal(firstSalePrice)
 *     priceChangePercent = ((Decimal(lastSalePrice) - Decimal(firstSalePrice)) / Decimal(firstSalePrice)) * 100
 */
export function getMarketStats(options: MarketStatsOptions): MarketStatsResult {
  const currencyParam = options.currency || 'TON';
  const normKey = normalizeInstrumentKey(options.instrumentKey, currencyParam);
  const parsed = parseInstrumentKey(normKey);
  const currency = parsed.currency;

  let from = typeof options.from === 'number' && !isNaN(options.from) ? options.from : undefined;
  let to = typeof options.to === 'number' && !isNaN(options.to) ? options.to : undefined;

  // Handle timeframe shortcut if explicitly given without from/to
  if (from === undefined && options.timeframe) {
    const tf = options.timeframe;
    const now = Date.now();
    if (tf === '24h' || tf === '1d') {
      from = now - 24 * 3600 * 1000;
      to = now + 1000;
    } else if (tf === '1h') {
      from = now - 3600 * 1000;
      to = now + 1000;
    } else if (tf === '7d' || tf === '1w') {
      from = now - 7 * 24 * 3600 * 1000;
      to = now + 1000;
    } else if (tf === '30d' || tf === '1M') {
      from = now - 30 * 24 * 3600 * 1000;
      to = now + 1000;
    } else if (tf === '1m') {
      from = now - 60 * 1000;
      to = now + 1000;
    } else if (tf === '5m') {
      from = now - 5 * 60 * 1000;
      to = now + 1000;
    } else if (tf === '15m') {
      from = now - 15 * 60 * 1000;
      to = now + 1000;
    } else if (tf === '4h') {
      from = now - 4 * 3600 * 1000;
      to = now + 1000;
    } else if (tf === '1s') {
      from = now - 1000;
      to = now + 1000;
    }
  }

  // Fetch floor price & listed count from floorManager
  const floorData = getFloorPrice(normKey, currency);

  // Filter completed sales for this instrumentKey and time window
  const matchingSales = allSales.filter((s: GiftSale) => {
    if (s.status !== 'completed') return false;
    if (s.currency !== currency) return false;

    const saleKey = getInstrumentKey(s);
    if (saleKey !== normKey) return false;

    if (from !== undefined && s.eventTime < from) return false;
    if (to !== undefined && s.eventTime >= to) return false;

    return true;
  });

  // Sort matching sales chronologically by eventTime ASC, tiebreaker id ASC
  matchingSales.sort((a, b) => {
    if (a.eventTime !== b.eventTime) return a.eventTime - b.eventTime;
    return a.id.localeCompare(b.id);
  });

  const salesCount = matchingSales.length;

  if (salesCount === 0) {
    return {
      instrumentKey: normKey,
      currency,
      timeframe: options.timeframe,
      from,
      to,
      lastSalePrice: null,
      lastSaleTime: null,
      floorPrice: floorData.floorPrice,
      listedCount: floorData.listedCount,
      averageSalePrice: null,
      salesCount: 0,
      volume: null,
      quoteVolume: null,
      priceChange: null,
      priceChangePercent: null,
      supply: null,
      updatedAt: Date.now(),
    };
  }

  const firstSale = matchingSales[0];
  const lastSale = matchingSales[matchingSales.length - 1];

  const lastSalePrice = lastSale.price;
  const lastSaleTime = lastSale.eventTime;

  let sumQuantity = new Decimal(0);
  let sumQuote = new Decimal(0);

  for (const s of matchingSales) {
    const q = new Decimal(s.quantity);
    const p = new Decimal(s.price);
    sumQuantity = sumQuantity.plus(q);
    sumQuote = sumQuote.plus(p.mul(q));
  }

  const averageSalePrice = sumQuote.div(sumQuantity).toString();
  const volume = sumQuantity.toString();
  const quoteVolume = sumQuote.toString();

  // Price change calculation using baseline (firstSale)
  const firstPriceDec = new Decimal(firstSale.price);
  const lastPriceDec = new Decimal(lastSale.price);

  let priceChange: string | null = null;
  let priceChangePercent: string | null = null;

  if (firstPriceDec.gt(0)) {
    const changeDec = lastPriceDec.minus(firstPriceDec);
    priceChange = changeDec.toString();

    const percentDec = changeDec.div(firstPriceDec).mul(100);
    priceChangePercent = percentDec.toString();
  }

  return {
    instrumentKey: normKey,
    currency,
    timeframe: options.timeframe,
    from,
    to,
    lastSalePrice,
    lastSaleTime,
    floorPrice: floorData.floorPrice,
    listedCount: floorData.listedCount,
    averageSalePrice,
    salesCount,
    volume,
    quoteVolume,
    priceChange,
    priceChangePercent,
    supply: null,
    updatedAt: Date.now(),
  };
}
