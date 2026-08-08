import Decimal from 'decimal.js';

export type Timeframe = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

export type GiftSale = {
  id: string;
  collectionId: string;
  giftId?: string;
  modelId?: string;
  backdropId?: string;
  symbol?: string;
  price: string;
  currency: "TON" | "STARS";
  quantity: string;
  eventTime: number;
  createdAt: number;
  sellerId?: string;
  buyerId?: string;
  transactionHash?: string;
  source?: string;
  status: "completed" | "reverted" | "cancelled" | "pending";
};

export type GiftCandle = {
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
  itemCount: string;
  sumQuote: string;
  sumQuantity: string;
  firstSaleId: string;
  lastSaleId: string;
  confirmed: boolean;
  revision: number;
  updatedAt: number;
};

export function getInstrumentKey(sale: Partial<GiftSale>): string {
  const c = sale.collectionId || "any";
  const m = sale.modelId || "any";
  const b = sale.backdropId || "any";
  const cur = sale.currency || "TON";
  return `${c}:${m}:${b}:${cur}`;
}

export function getCandleRange(timestamp: number, timeframe: Timeframe): { startTime: number, endTime: number } {
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
      endTime = startTime + 5 * 60000;
      break;
    case '15m':
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 15 * 60000;
      break;
    case '1h':
      d.setUTCMinutes(0, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 3600000;
      break;
    case '4h':
      d.setUTCHours(Math.floor(d.getUTCHours() / 4) * 4, 0, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 4 * 3600000;
      break;
    case '1d':
      d.setUTCHours(0, 0, 0, 0);
      startTime = d.getTime();
      endTime = startTime + 86400000;
      break;
    case '1w':
      d.setUTCHours(0, 0, 0, 0);
      // JS getUTCDay: 0 is Sunday, 1 is Monday. We want Monday to be start.
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); 
      d.setUTCDate(diff);
      startTime = d.getTime();
      endTime = startTime + 7 * 86400000;
      break;
    case '1M':
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      startTime = d.getTime();
      const nextMonth = new Date(d);
      nextMonth.setUTCMonth(d.getUTCMonth() + 1);
      endTime = nextMonth.getTime();
      break;
  }
  
  return { startTime, endTime };
}

export function createCandleFromSale(sale: GiftSale, timeframe: Timeframe): GiftCandle {
  const range = getCandleRange(sale.eventTime, timeframe);
  const price = new Decimal(sale.price);
  const quantity = new Decimal(sale.quantity);
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
    volume: sale.quantity,
    quoteVolume: quote.toString(),
    tradeCount: 1,
    itemCount: sale.quantity,
    sumQuote: quote.toString(),
    sumQuantity: sale.quantity,
    firstSaleId: sale.id,
    lastSaleId: sale.id,
    confirmed: false,
    revision: 1,
    updatedAt: Date.now()
  };
}

export function updateCandle(candle: GiftCandle, sale: GiftSale): GiftCandle {
  const price = new Decimal(sale.price);
  const quantity = new Decimal(sale.quantity);
  const quote = price.mul(quantity);

  const newCandle = { ...candle };
  
  // Tie breaking
  const isEarlier = sale.eventTime < candle.startTime /* simplified for now */ || false; 
  const isLater = sale.eventTime >= candle.endTime /* simplified */ || true;

  if (price.gt(newCandle.high)) newCandle.high = sale.price;
  if (price.lt(newCandle.low)) newCandle.low = sale.price;

  // Ideally we store all events or track actual earliest/latest times
  // For this implementation, we assume streaming chronological arrival mostly
  newCandle.close = sale.price;
  newCandle.lastSaleId = sale.id;

  newCandle.volume = new Decimal(newCandle.volume).plus(quantity).toString();
  newCandle.quoteVolume = new Decimal(newCandle.quoteVolume).plus(quote).toString();
  newCandle.tradeCount += 1;
  newCandle.itemCount = newCandle.volume; // Assuming same for gifts
  newCandle.sumQuote = new Decimal(newCandle.sumQuote).plus(quote).toString();
  newCandle.sumQuantity = new Decimal(newCandle.sumQuantity).plus(quantity).toString();
  
  newCandle.revision += 1;
  newCandle.updatedAt = Date.now();

  return newCandle;
}
