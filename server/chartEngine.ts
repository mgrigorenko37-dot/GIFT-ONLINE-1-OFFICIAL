import Decimal from 'decimal.js';
import {
  Timeframe,
  GiftSale,
  GiftCandle,
  buildInstrumentKey,
} from '../src/types/market';

export type { Timeframe, GiftSale, GiftCandle };

export function getInstrumentKey(sale: Partial<GiftSale>): string {
  return buildInstrumentKey({
    collectionId: sale.collectionId || "unknown",
    modelId: sale.modelId,
    backdropId: sale.backdropId,
    currency: sale.currency || "TON",
  });
}

export function getCandleRange(timestamp: number, timeframe: Timeframe): { startTime: number, endTime: number } {
  if (typeof timestamp !== 'number') {
    throw new Error(`Invalid timestamp type: ${typeof timestamp} (${timestamp}). Expected number in Unix milliseconds.`);
  }

  if (isNaN(timestamp) || !isFinite(timestamp)) {
    throw new Error(`Invalid timestamp value: ${timestamp}. Expected a finite number in Unix milliseconds.`);
  }

  if (timestamp < 0) {
    throw new Error(`Invalid timestamp: ${timestamp}. Negative timestamps are not supported.`);
  }

  if (timestamp > 0 && timestamp < 100000000000) {
    throw new Error(`Invalid timestamp: ${timestamp}. Expected Unix timestamp in milliseconds, not seconds.`);
  }

  const VALID_TIMEFRAMES: Timeframe[] = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];
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
  const qtyStr = String(sale.quantity || '1');
  const price = new Decimal(sale.price);
  const quantity = new Decimal(qtyStr);
  const quote = price.mul(quantity);

  return {
    instrumentKey: getInstrumentKey(sale),
    timeframe,
    startTime: range.startTime,
    endTime: range.endTime,
    open: sale.price,
    high: sale.price,
    low: sale.price,
    close: sale.price,
    volume: qtyStr,
    quoteVolume: quote.toString(),
    tradeCount: 1,
    itemCount: qtyStr,
    sumQuote: quote.toString(),
    sumQuantity: qtyStr,
    firstSaleId: sale.id,
    lastSaleId: sale.id,
    confirmed: false,
    revision: 1,
    updatedAt: Date.now()
  };
}

export function updateCandle(candle: GiftCandle, sale: GiftSale): GiftCandle {
  const qtyStr = String(sale.quantity || '1');
  const price = new Decimal(sale.price);
  const quantity = new Decimal(qtyStr);
  const quote = price.mul(quantity);

  const newCandle = { ...candle };

  if (price.gt(newCandle.high)) newCandle.high = sale.price;
  if (price.lt(newCandle.low)) newCandle.low = sale.price;

  newCandle.close = sale.price;
  newCandle.lastSaleId = sale.id;

  newCandle.volume = new Decimal(newCandle.volume).plus(quantity).toString();
  newCandle.quoteVolume = new Decimal(newCandle.quoteVolume).plus(quote).toString();
  newCandle.tradeCount += 1;
  newCandle.itemCount = newCandle.volume;
  newCandle.sumQuote = new Decimal(newCandle.sumQuote || '0').plus(quote).toString();
  newCandle.sumQuantity = new Decimal(newCandle.sumQuantity || '0').plus(quantity).toString();
  
  newCandle.revision += 1;
  newCandle.updatedAt = Date.now();

  return newCandle;
}
