import { GiftSale, GiftCandle, Timeframe, getInstrumentKey, createCandleFromSale, updateCandle, getCandleRange } from './chartEngine';
import { normalizeInstrumentKey } from '../src/types/market';

export const allSales: GiftSale[] = [];
export const activeCandles: Record<string, Record<string, GiftCandle>> = {};
export const closedCandles: Record<string, Record<string, GiftCandle[]>> = {};

export function getHistory(instrumentKey: string, timeframe: Timeframe, from: number, to: number, limit: number = 500) {
  const normKey = normalizeInstrumentKey(instrumentKey);
  const closed = closedCandles[normKey]?.[timeframe] || [];
  const active = activeCandles[normKey]?.[timeframe];

  let result = closed.filter(c => c.startTime >= from && c.startTime < to);
  if (active && active.startTime >= from && active.startTime < to) {
    result.push(active);
  }
  
  result.sort((a,b) => a.startTime - b.startTime);
  if (limit && result.length > limit) {
    result = result.slice(-limit);
  }
  return result;
}

export function processSale(sale: GiftSale) {
  if (sale.status !== "completed") return;
  if (allSales.find(s => s.id === sale.id)) return; // Deduplicate

  allSales.push(sale);
  const instrumentKey = getInstrumentKey(sale);

  if (!activeCandles[instrumentKey]) {
    activeCandles[instrumentKey] = {};
  }
  if (!closedCandles[instrumentKey]) {
    closedCandles[instrumentKey] = {};
  }

  const timeframes: Timeframe[] = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"];

  const updatedCandles = [];

  for (const tf of timeframes) {
    const range = getCandleRange(sale.eventTime, tf);
    let currentCandle = activeCandles[instrumentKey][tf];

    if (!closedCandles[instrumentKey][tf]) {
      closedCandles[instrumentKey][tf] = [];
    }

    if (!currentCandle) {
      currentCandle = createCandleFromSale(sale, tf);
      activeCandles[instrumentKey][tf] = currentCandle;
      updatedCandles.push(currentCandle);
    } else {
      if (sale.eventTime >= currentCandle.endTime) {
        currentCandle.confirmed = true;
        closedCandles[instrumentKey][tf].push({ ...currentCandle });

        currentCandle = createCandleFromSale(sale, tf);
        activeCandles[instrumentKey][tf] = currentCandle;
        updatedCandles.push(currentCandle);
      } else if (sale.eventTime < currentCandle.startTime) {
        const pastCandleIdx = closedCandles[instrumentKey][tf].findIndex(c => sale.eventTime >= c.startTime && sale.eventTime < c.endTime);
        if (pastCandleIdx !== -1) {
           const pc = closedCandles[instrumentKey][tf][pastCandleIdx];
           closedCandles[instrumentKey][tf][pastCandleIdx] = updateCandle(pc, sale);
           updatedCandles.push(closedCandles[instrumentKey][tf][pastCandleIdx]);
        } else {
           const newClosed = createCandleFromSale(sale, tf);
           newClosed.confirmed = true;
           closedCandles[instrumentKey][tf].push(newClosed);
           closedCandles[instrumentKey][tf].sort((a,b) => a.startTime - b.startTime);
           updatedCandles.push(newClosed);
        }
      } else {
        currentCandle = updateCandle(currentCandle, sale);
        activeCandles[instrumentKey][tf] = currentCandle;
        updatedCandles.push(currentCandle);
      }
    }
  }

  return updatedCandles;
}
