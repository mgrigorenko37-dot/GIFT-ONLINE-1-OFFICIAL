import Decimal from 'decimal.js';
import {
  GiftCandle,
  Timeframe,
  Currency,
  normalizeInstrumentKey,
  parseInstrumentKey,
} from '../src/types/market';
import { getHistory, getActiveCandle } from './marketState';
import { getFloorPrice } from './floorManager';

export type IndicatorType = 'sma' | 'ema' | 'rsi' | 'macd';
export type IndicatorSource = 'close' | 'floor' | 'average';

export interface IndicatorPoint {
  timestamp: number;
  value: string | null;
  macdLine?: string | null;
  signalLine?: string | null;
  histogram?: string | null;
  isProvisional: boolean;
  source: IndicatorSource;
}

export interface IndicatorOptions {
  instrumentKey: string;
  currency?: Currency;
  timeframe: Timeframe;
  indicator: IndicatorType;
  source?: IndicatorSource;
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  from?: number;
  to?: number;
  candles?: GiftCandle[];
}

export interface IndicatorResult {
  instrumentKey: string;
  timeframe: Timeframe;
  indicator: IndicatorType;
  source: IndicatorSource;
  points: IndicatorPoint[];
  updatedAt: number;
}

function extractPrice(
  candle: GiftCandle,
  source: IndicatorSource,
  instrumentKey: string,
  currency: Currency
): Decimal | null {
  if (source === 'close') {
    if (!candle.close) return null;
    try {
      const d = new Decimal(candle.close);
      if (d.isNaN() || !d.isFinite() || d.lte(0)) return null;
      return d;
    } catch {
      return null;
    }
  }

  if (source === 'average') {
    let sumQuote: Decimal | null = null;
    let sumQty: Decimal | null = null;

    if (candle.sumQuote !== undefined && candle.sumQuantity !== undefined) {
      try {
        sumQuote = new Decimal(candle.sumQuote);
        sumQty = new Decimal(candle.sumQuantity);
      } catch {
        sumQuote = null;
        sumQty = null;
      }
    } else if (candle.quoteVolume !== undefined && candle.volume !== undefined) {
      try {
        sumQuote = new Decimal(candle.quoteVolume);
        sumQty = new Decimal(candle.volume);
      } catch {
        sumQuote = null;
        sumQty = null;
      }
    }

    if (!sumQuote || !sumQty || sumQty.lte(0) || sumQuote.lte(0)) {
      return null;
    }

    return sumQuote.div(sumQty);
  }

  if (source === 'floor') {
    const floorData = getFloorPrice(instrumentKey, currency);
    if (!floorData.floorPrice) return null;
    try {
      const d = new Decimal(floorData.floorPrice);
      if (d.isNaN() || !d.isFinite() || d.lte(0)) return null;
      return d;
    } catch {
      return null;
    }
  }

  return null;
}

export function calculateSMA(
  pointsData: { timestamp: number; price: Decimal | null; isProvisional: boolean }[],
  period: number,
  source: IndicatorSource
): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];

  for (let i = 0; i < pointsData.length; i++) {
    const currentPoint = pointsData[i];

    if (i < period - 1) {
      result.push({
        timestamp: currentPoint.timestamp,
        value: null,
        isProvisional: currentPoint.isProvisional,
        source,
      });
      continue;
    }

    let sum = new Decimal(0);
    let valid = true;

    for (let j = i - period + 1; j <= i; j++) {
      const p = pointsData[j].price;
      if (!p) {
        valid = false;
        break;
      }
      sum = sum.plus(p);
    }

    if (!valid) {
      result.push({
        timestamp: currentPoint.timestamp,
        value: null,
        isProvisional: currentPoint.isProvisional,
        source,
      });
    } else {
      const avg = sum.div(period);
      result.push({
        timestamp: currentPoint.timestamp,
        value: avg.toString(),
        isProvisional: currentPoint.isProvisional,
        source,
      });
    }
  }

  return result;
}

export function calculateEMA(
  pointsData: { timestamp: number; price: Decimal | null; isProvisional: boolean }[],
  period: number,
  source: IndicatorSource
): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  const k = new Decimal(2).div(period + 1);

  let currentEMA: Decimal | null = null;
  let consecutivePrices: Decimal[] = [];

  for (let i = 0; i < pointsData.length; i++) {
    const currentPoint = pointsData[i];
    const price = currentPoint.price;

    if (!price) {
      consecutivePrices = [];
      currentEMA = null;
      result.push({
        timestamp: currentPoint.timestamp,
        value: null,
        isProvisional: currentPoint.isProvisional,
        source,
      });
      continue;
    }

    if (currentEMA === null) {
      consecutivePrices.push(price);
      if (consecutivePrices.length < period) {
        result.push({
          timestamp: currentPoint.timestamp,
          value: null,
          isProvisional: currentPoint.isProvisional,
          source,
        });
      } else {
        let sum = new Decimal(0);
        for (const p of consecutivePrices) {
          sum = sum.plus(p);
        }
        currentEMA = sum.div(period);
        result.push({
          timestamp: currentPoint.timestamp,
          value: currentEMA.toString(),
          isProvisional: currentPoint.isProvisional,
          source,
        });
      }
    } else {
      currentEMA = price.mul(k).plus(currentEMA.mul(new Decimal(1).minus(k)));
      result.push({
        timestamp: currentPoint.timestamp,
        value: currentEMA.toString(),
        isProvisional: currentPoint.isProvisional,
        source,
      });
    }
  }

  return result;
}

export function calculateRSI(
  pointsData: { timestamp: number; price: Decimal | null; isProvisional: boolean }[],
  period: number,
  source: IndicatorSource
): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];

  let validSeries: { timestamp: number; price: Decimal; isProvisional: boolean }[] = [];

  // Filter valid prices while mapping back to timestamps
  const validMap = new Map<number, { rsi: Decimal | null }>();

  let avgGain: Decimal | null = null;
  let avgLoss: Decimal | null = null;

  for (let i = 0; i < pointsData.length; i++) {
    const pt = pointsData[i];
    if (!pt.price) {
      validSeries = [];
      avgGain = null;
      avgLoss = null;
      result.push({
        timestamp: pt.timestamp,
        value: null,
        isProvisional: pt.isProvisional,
        source,
      });
      continue;
    }

    validSeries.push({ timestamp: pt.timestamp, price: pt.price, isProvisional: pt.isProvisional });

    if (validSeries.length <= period) {
      result.push({
        timestamp: pt.timestamp,
        value: null,
        isProvisional: pt.isProvisional,
        source,
      });
      continue;
    }

    if (avgGain === null || avgLoss === null) {
      // First RSI calculation: SMA of gains and losses over initial period
      let sumGain = new Decimal(0);
      let sumLoss = new Decimal(0);

      for (let j = 1; j <= period; j++) {
        const diff = validSeries[j].price.minus(validSeries[j - 1].price);
        if (diff.gt(0)) {
          sumGain = sumGain.plus(diff);
        } else if (diff.lt(0)) {
          sumLoss = sumLoss.plus(diff.abs());
        }
      }

      avgGain = sumGain.div(period);
      avgLoss = sumLoss.div(period);
    } else {
      // Wilder's smoothing for subsequent periods
      const lastIdx = validSeries.length - 1;
      const diff = validSeries[lastIdx].price.minus(validSeries[lastIdx - 1].price);
      const gain = diff.gt(0) ? diff : new Decimal(0);
      const loss = diff.lt(0) ? diff.abs() : new Decimal(0);

      avgGain = avgGain
        .mul(period - 1)
        .plus(gain)
        .div(period);
      avgLoss = avgLoss
        .mul(period - 1)
        .plus(loss)
        .div(period);
    }

    let rsiVal: Decimal;
    const totalAvg = avgGain.plus(avgLoss);

    if (totalAvg.isZero()) {
      rsiVal = new Decimal(50);
    } else {
      rsiVal = new Decimal(100).mul(avgGain).div(totalAvg);
    }

    if (rsiVal.gt(100)) rsiVal = new Decimal(100);
    if (rsiVal.lt(0)) rsiVal = new Decimal(0);

    result.push({
      timestamp: pt.timestamp,
      value: rsiVal.toString(),
      isProvisional: pt.isProvisional,
      source,
    });
  }

  return result;
}

export function calculateMACD(
  pointsData: { timestamp: number; price: Decimal | null; isProvisional: boolean }[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
  source: IndicatorSource
): IndicatorPoint[] {
  const fastEMA = calculateEMA(pointsData, fastPeriod, source);
  const slowEMA = calculateEMA(pointsData, slowPeriod, source);

  const macdPoints: { timestamp: number; price: Decimal | null; isProvisional: boolean }[] = [];

  for (let i = 0; i < pointsData.length; i++) {
    const fastVal = fastEMA[i].value;
    const slowVal = slowEMA[i].value;

    if (fastVal !== null && slowVal !== null) {
      const macdDec = new Decimal(fastVal).minus(new Decimal(slowVal));
      macdPoints.push({
        timestamp: pointsData[i].timestamp,
        price: macdDec,
        isProvisional: pointsData[i].isProvisional,
      });
    } else {
      macdPoints.push({
        timestamp: pointsData[i].timestamp,
        price: null,
        isProvisional: pointsData[i].isProvisional,
      });
    }
  }

  const signalEMA = calculateEMA(macdPoints, signalPeriod, source);

  const result: IndicatorPoint[] = [];

  for (let i = 0; i < pointsData.length; i++) {
    const macdDec = macdPoints[i].price;
    const sigVal = signalEMA[i].value;

    const macdStr = macdDec !== null ? macdDec.toString() : null;
    const sigStr = sigVal !== null ? sigVal : null;

    let histStr: string | null = null;
    if (macdDec !== null && sigVal !== null) {
      histStr = macdDec.minus(new Decimal(sigVal)).toString();
    }

    result.push({
      timestamp: pointsData[i].timestamp,
      value: macdStr,
      macdLine: macdStr,
      signalLine: sigStr,
      histogram: histStr,
      isProvisional: pointsData[i].isProvisional,
      source,
    });
  }

  return result;
}

export function getIndicators(options: IndicatorOptions): IndicatorResult {
  const currency = options.currency || 'TON';
  const normKey = normalizeInstrumentKey(options.instrumentKey, currency);
  const parsed = parseInstrumentKey(normKey);

  const source = options.source || 'close';
  const indicator = options.indicator || 'sma';
  const timeframe = options.timeframe;

  let candles: GiftCandle[] = [];

  if (options.candles && Array.isArray(options.candles)) {
    candles = options.candles;
  } else {
    const from = options.from ?? 0;
    const to = options.to ?? Date.now() + 86400000;

    const closedCandles = getHistory(normKey, timeframe, from, to);
    const activeCandle = getActiveCandle(normKey, timeframe);

    candles = [...closedCandles];

    if (activeCandle) {
      // Check if activeCandle falls into [from, to)
      if (activeCandle.startTime >= from && activeCandle.startTime < to) {
        // Prevent duplicate if activeCandle already in closedCandles
        const exists = candles.some((c) => c.startTime === activeCandle.startTime);
        if (!exists) {
          candles.push(activeCandle);
        }
      }
    }
  }

  // Ensure candles sorted by startTime ASC
  candles.sort((a, b) => a.startTime - b.startTime);

  const pointsData = candles.map((c) => {
    const price = extractPrice(c, source, normKey, parsed.currency);
    const isProvisional = c.confirmed === false;
    return {
      timestamp: c.startTime,
      price,
      isProvisional,
    };
  });

  let points: IndicatorPoint[] = [];

  if (indicator === 'sma') {
    const period = options.period || 20;
    points = calculateSMA(pointsData, period, source);
  } else if (indicator === 'ema') {
    const period = options.period || 20;
    points = calculateEMA(pointsData, period, source);
  } else if (indicator === 'rsi') {
    const period = options.period || 14;
    points = calculateRSI(pointsData, period, source);
  } else if (indicator === 'macd') {
    const fastPeriod = options.fastPeriod || 12;
    const slowPeriod = options.slowPeriod || 26;
    const signalPeriod = options.signalPeriod || 9;
    points = calculateMACD(pointsData, fastPeriod, slowPeriod, signalPeriod, source);
  }

  return {
    instrumentKey: normKey,
    timeframe,
    indicator,
    source,
    points,
    updatedAt: Date.now(),
  };
}
