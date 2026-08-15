import Decimal from 'decimal.js';
import { Timeframe, GiftSale, GiftCandle, buildInstrumentKey } from '../src/types/market';

export type { Timeframe, GiftSale, GiftCandle };

// Configure Decimal for precise financial arithmetic up to 30 digits without exponential notation
Decimal.set({ toExpNeg: -30, toExpPos: 30 });

export function parsePositiveDecimal(val: any): Decimal | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return null;
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val) || val <= 0) return null;
  }
  const str = String(val).trim();
  if (str === '') return null;
  try {
    const d = new Decimal(str);
    if (d.isNaN() || !d.isFinite() || !d.isPos() || d.isZero()) {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function isEarlierSale(
  timeA: number,
  idA: string,
  timeB: number | undefined,
  idB: string | undefined
): boolean {
  if (timeB === undefined || idB === undefined) return true;
  if (timeA !== timeB) {
    return timeA < timeB;
  }
  return idA < idB;
}

export function isLaterSale(
  timeA: number,
  idA: string,
  timeB: number | undefined,
  idB: string | undefined
): boolean {
  if (timeB === undefined || idB === undefined) return true;
  if (timeA !== timeB) {
    return timeA > timeB;
  }
  return idA > idB;
}

export function getInstrumentKey(sale: Partial<GiftSale>): string {
  return buildInstrumentKey({
    collectionId: sale.collectionId || 'unknown',
    modelId: sale.modelId,
    backdropId: sale.backdropId,
    currency: sale.currency || 'TON',
  });
}

export function getCandleRange(
  timestamp: number,
  timeframe: Timeframe
): { startTime: number; endTime: number } {
  if (typeof timestamp !== 'number') {
    throw new Error(
      `Invalid timestamp type: ${typeof timestamp} (${timestamp}). Expected number in Unix milliseconds.`
    );
  }

  if (isNaN(timestamp) || !isFinite(timestamp)) {
    throw new Error(
      `Invalid timestamp value: ${timestamp}. Expected a finite number in Unix milliseconds.`
    );
  }

  if (timestamp < 0) {
    throw new Error(`Invalid timestamp: ${timestamp}. Negative timestamps are not supported.`);
  }

  if (timestamp > 0 && timestamp < 100000000000) {
    throw new Error(
      `Invalid timestamp: ${timestamp}. Expected Unix timestamp in milliseconds, not seconds.`
    );
  }

  const VALID_TIMEFRAMES: Timeframe[] = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }

  const d = new Date(timestamp);
  let startTime = 0;
  let endTime = 0;

  switch (timeframe) {
    case '1s':
      d.setUTCMilliseconds(0);
      startTime = d.getTime();
      endTime = startTime + 1000;
      break;
    case '1m':
      d.setUTCSeconds(0, 0);
      startTime = d.getTime();
      endTime = startTime + 60000;
      break;
    case '5m':
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 300000;
      break;
    case '15m':
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 900000;
      break;
    case '1h':
      d.setUTCMinutes(0, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 3600000;
      break;
    case '4h':
      d.setUTCHours(Math.floor(d.getUTCHours() / 4) * 4, 0, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 14400000;
      break;
    case '1d':
      d.setUTCHours(0, 0, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 86400000;
      break;
    case '1w':
      d.setUTCHours(0, 0, 0, 0);
      // ISO week: Monday 00:00:00 UTC start
      const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
      const diffDays = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diffDays);
      startTime = d.getTime();
      endTime = startTime + 7 * 86400000;
      break;
    case '1M':
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      startTime = d.getTime();
      const nextMonth = new Date(d);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      endTime = nextMonth.getTime();
      break;
  }

  return { startTime, endTime };
}

export function createCandleFromSale(sale: GiftSale, timeframe: Timeframe): GiftCandle {
  const range = getCandleRange(sale.eventTime, timeframe);
  const pDec = parsePositiveDecimal(sale.price);
  if (!pDec) {
    throw new Error(`Invalid sale price: ${sale.price}`);
  }
  const qDec = parsePositiveDecimal(sale.quantity) || new Decimal(1);
  const quoteDec = pDec.mul(qDec);

  const priceStr = pDec.toString();
  const qtyStr = qDec.toString();
  const quoteStr = quoteDec.toString();

  return {
    instrumentKey: getInstrumentKey(sale),
    timeframe,
    startTime: range.startTime,
    endTime: range.endTime,
    open: priceStr,
    high: priceStr,
    low: priceStr,
    close: priceStr,
    volume: qtyStr,
    quoteVolume: quoteStr,
    tradeCount: 1,
    itemCount: qtyStr,
    sumQuote: quoteStr,
    sumQuantity: qtyStr,
    firstSaleId: sale.id,
    firstSaleTime: sale.eventTime,
    lastSaleId: sale.id,
    lastSaleTime: sale.eventTime,
    confirmed: false,
    revision: 1,
    updatedAt: Date.now(),
  };
}

export function updateCandle(candle: GiftCandle, sale: GiftSale): GiftCandle {
  const pDec = parsePositiveDecimal(sale.price);
  if (!pDec) {
    throw new Error(`Invalid sale price: ${sale.price}`);
  }
  const qDec = parsePositiveDecimal(sale.quantity) || new Decimal(1);
  const quoteDec = pDec.mul(qDec);

  const priceStr = pDec.toString();

  const newCandle: GiftCandle = { ...candle };

  // 1. High Check (Decimal comparison)
  const currentHighDec = new Decimal(newCandle.high);
  if (pDec.gt(currentHighDec)) {
    newCandle.high = priceStr;
  }

  // 2. Low Check (Decimal comparison)
  const currentLowDec = new Decimal(newCandle.low);
  if (pDec.lt(currentLowDec)) {
    newCandle.low = priceStr;
  }

  // 3. Open Check (Earliest sale tie-breaker)
  if (isEarlierSale(sale.eventTime, sale.id, newCandle.firstSaleTime, newCandle.firstSaleId)) {
    newCandle.open = priceStr;
    newCandle.firstSaleId = sale.id;
    newCandle.firstSaleTime = sale.eventTime;
  }

  // 4. Close Check (Latest sale tie-breaker)
  if (isLaterSale(sale.eventTime, sale.id, newCandle.lastSaleTime, newCandle.lastSaleId)) {
    newCandle.close = priceStr;
    newCandle.lastSaleId = sale.id;
    newCandle.lastSaleTime = sale.eventTime;
  }

  // 5. Volume & Quote Volume updates (Decimal arithmetic)
  const newVolDec = new Decimal(newCandle.volume).plus(qDec);
  const newQuoteVolDec = new Decimal(newCandle.quoteVolume).plus(quoteDec);

  newCandle.volume = newVolDec.toString();
  newCandle.quoteVolume = newQuoteVolDec.toString();
  newCandle.tradeCount += 1;
  newCandle.itemCount = newCandle.volume;
  newCandle.sumQuote = newCandle.quoteVolume;
  newCandle.sumQuantity = newCandle.volume;

  newCandle.revision += 1;
  newCandle.updatedAt = Date.now();

  return newCandle;
}

export function getAveragePrice(candle: GiftCandle): string {
  const sumQuote = new Decimal(candle.sumQuote || candle.quoteVolume || '0');
  const sumQuantity = new Decimal(candle.sumQuantity || candle.volume || '0');
  if (sumQuantity.isZero()) return '0';
  return sumQuote.div(sumQuantity).toString();
}
