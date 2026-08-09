import { describe, test } from 'vitest';
import Decimal from 'decimal.js';
import { GiftCandle, Timeframe } from '../src/types/market';
import { clearMarketState, acceptCompletedSale, getActiveCandle } from './marketState';
import { clearFloorState, addListing } from './floorManager';
import { getIndicators, calculateSMA, calculateEMA, calculateRSI, calculateMACD } from './indicatorEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

describe('Stage 12: Telegram Gifts Technical Indicators Scenarios', () => {
  test('Runs Stage 12 Indicator Engine Scenarios', () => {

// 1. SMA Test
{
  const points = [
    { timestamp: 1000, price: new Decimal(10), isProvisional: false },
    { timestamp: 2000, price: new Decimal(20), isProvisional: false },
    { timestamp: 3000, price: new Decimal(30), isProvisional: false },
    { timestamp: 4000, price: new Decimal(40), isProvisional: false },
  ];

  const sma3 = calculateSMA(points, 3, 'close');

  assert(sma3[0].value === null, 'Test 1: SMA(3) at index 0 is null');
  assert(sma3[1].value === null, 'Test 1: SMA(3) at index 1 is null');
  assert(sma3[2].value === '20', 'Test 1: SMA(3) at index 2 is (10+20+30)/3 = 20');
  assert(sma3[3].value === '30', 'Test 1: SMA(3) at index 3 is (20+30+40)/3 = 30');

  console.log('✓ Test 1 passed: SMA calculation precision');
}

// 2. EMA Test
{
  const points = [
    { timestamp: 1000, price: new Decimal(10), isProvisional: false },
    { timestamp: 2000, price: new Decimal(20), isProvisional: false },
    { timestamp: 3000, price: new Decimal(30), isProvisional: false },
  ];

  // EMA(2), multiplier k = 2 / (2 + 1) = 2/3
  // First EMA at idx 1: SMA(2) = (10+20)/2 = 15
  // Second EMA at idx 2: 30 * (2/3) + 15 * (1/3) = 20 + 5 = 25
  const ema2 = calculateEMA(points, 2, 'close');

  assert(ema2[0].value === null, 'Test 2: EMA(2) at index 0 is null');
  assert(ema2[1].value === '15', 'Test 2: EMA(2) at index 1 is 15');
  assert(ema2[2].value === '25', 'Test 2: EMA(2) at index 2 is 25');

  console.log('✓ Test 2 passed: EMA exponential smoothing calculation');
}

// 3. RSI Test
{
  const prices = [10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 21, 20, 22, 24, 23, 25];
  const points = prices.map((p, idx) => ({
    timestamp: (idx + 1) * 1000,
    price: new Decimal(p),
    isProvisional: false,
  }));

  const rsi14 = calculateRSI(points, 14, 'close');

  assert(rsi14[0].value === null, 'Test 3: RSI(14) before period is null');
  assert(rsi14[13].value === null, 'Test 3: RSI(14) before 14 changes is null');
  assert(rsi14[14].value !== null, 'Test 3: RSI(14) at idx 14 is non-null');

  const valNum = Number(rsi14[14].value);
  assert(valNum >= 0 && valNum <= 100, 'Test 3: RSI is bounded between 0 and 100');

  console.log('✓ Test 3 passed: RSI Wilder smoothing calculation');
}

// 4. MACD Test
{
  const points = Array.from({ length: 40 }, (_, idx) => ({
    timestamp: (idx + 1) * 1000,
    price: new Decimal(100 + Math.sin(idx) * 10),
    isProvisional: false,
  }));

  const macd = calculateMACD(points, 12, 26, 9, 'close');

  assert(macd.length === 40, 'Test 4: MACD result length matches points length');
  assert(macd[25].macdLine !== null, 'Test 4: MACD line at idx 25 is non-null');
  assert(macd[34].signalLine !== null, 'Test 4: Signal line at idx 34 is non-null');
  assert(macd[34].histogram !== null, 'Test 4: Histogram at idx 34 is non-null');

  console.log('✓ Test 4 passed: MACD line, signal line, and histogram');
}

// 5. Missing candles / Empty periods
{
  const points = [
    { timestamp: 1000, price: new Decimal(10), isProvisional: false },
    { timestamp: 2000, price: null, isProvisional: false }, // missing/empty period
    { timestamp: 3000, price: new Decimal(20), isProvisional: false },
    { timestamp: 4000, price: new Decimal(30), isProvisional: false },
  ];

  const sma2 = calculateSMA(points, 2, 'close');

  assert(sma2[0].value === null, 'Test 5: SMA(2) at idx 0 is null');
  assert(sma2[1].value === null, 'Test 5: SMA(2) at idx 1 with null price is null');
  assert(sma2[2].value === null, 'Test 5: SMA(2) at idx 2 following null price is null');
  assert(sma2[3].value === '25', 'Test 5: SMA(2) at idx 3 is (20+30)/2 = 25');

  console.log('✓ Test 5 passed: Missing/empty candles handled safely without converting to 0');
}

// 6. Active candle & provisional status
{
  clearMarketState();
  clearFloorState();

  const baseTime = Date.now() - 30000;

  acceptCompletedSale({
    id: 's1',
    collectionId: 'durov-cap',
    price: '10',
    quantity: '1',
    currency: 'TON',
    eventTime: baseTime,
    status: 'completed',
  });

  acceptCompletedSale({
    id: 's2',
    collectionId: 'durov-cap',
    price: '20',
    quantity: '1',
    currency: 'TON',
    eventTime: baseTime + 1000,
    status: 'completed',
  });

  // Get indicators for active candle timeframe
  const res = getIndicators({
    instrumentKey: 'durov-cap:all:all:TON',
    timeframe: '1m',
    indicator: 'sma',
    period: 1,
    source: 'close',
  });

  assert(res.points.length > 0, 'Test 6: Indicators returned points');
  const lastPoint = res.points[res.points.length - 1];
  assert(lastPoint.isProvisional === true, 'Test 6: Active candle indicator is marked as isProvisional = true');

  console.log('✓ Test 6 passed: Active candle indicator is correctly marked as isProvisional = true');
}

// 7. Correction / Recalculation
{
  clearMarketState();
  clearFloorState();

  const baseTime = 1710000000000;

  // Initial sale
  acceptCompletedSale({
    id: 's1',
    collectionId: 'durov-cap',
    price: '10',
    quantity: '1',
    currency: 'TON',
    eventTime: baseTime,
    status: 'completed',
  });

  const res1 = getIndicators({
    instrumentKey: 'durov-cap:all:all:TON',
    timeframe: '1m',
    indicator: 'sma',
    period: 1,
    from: baseTime - 1000,
    to: baseTime + 60000,
  });

  assert(res1.points[0].value === '10', 'Test 7: Initial SMA(1) is 10');

  // Correction: late higher price sale ingested for same candle
  acceptCompletedSale({
    id: 's2',
    collectionId: 'durov-cap',
    price: '30',
    quantity: '1',
    currency: 'TON',
    eventTime: baseTime + 500,
    status: 'completed',
  });

  const res2 = getIndicators({
    instrumentKey: 'durov-cap:all:all:TON',
    timeframe: '1m',
    indicator: 'sma',
    period: 1,
    from: baseTime - 1000,
    to: baseTime + 60000,
  });

  assert(res2.points[0].value === '30', 'Test 7: After correction, SMA(1) updated to 30 (new close)');

  console.log('✓ Test 7 passed: Correction recalculates indicator dynamically');
}

// 8. Independent calculation across ALL timeframes
{
  clearMarketState();
  clearFloorState();

  const tfs: Timeframe[] = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];

  for (const tf of tfs) {
    const res = getIndicators({
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: tf,
      indicator: 'sma',
      period: 5,
    });
    assert(res.timeframe === tf, `Test 8: Timeframe ${tf} returned correct metadata`);
    assert(Array.isArray(res.points), `Test 8: Timeframe ${tf} returned points array`);
  }

  console.log('✓ Test 8 passed: Independent indicator calculations supported for all 9 timeframes');
}

// 9. Different Data Sources (close, floor, average)
{
  clearMarketState();
  clearFloorState();

  // Add floor listing
  addListing({ listingId: 'lst1', instrumentKey: 'durov-cap:all:all:TON', price: '50.0', currency: 'TON' });

  // Add sale: price 10, quantity 2 (total quote = 20, avg = 10)
  acceptCompletedSale({
    id: 's1',
    collectionId: 'durov-cap',
    price: '10',
    quantity: '2',
    currency: 'TON',
    eventTime: 1710000000000,
    status: 'completed',
  });

  const closeRes = getIndicators({
    instrumentKey: 'durov-cap:all:all:TON',
    timeframe: '1m',
    indicator: 'sma',
    source: 'close',
    period: 1,
    from: 1710000000000,
    to: 1710000060000,
  });

  const averageRes = getIndicators({
    instrumentKey: 'durov-cap:all:all:TON',
    timeframe: '1m',
    indicator: 'sma',
    source: 'average',
    period: 1,
    from: 1710000000000,
    to: 1710000060000,
  });

  const floorRes = getIndicators({
    instrumentKey: 'durov-cap:all:all:TON',
    timeframe: '1m',
    indicator: 'sma',
    source: 'floor',
    period: 1,
    from: 1710000000000,
    to: 1710000060000,
  });

  assert(closeRes.points[0].value === '10', 'Test 9: Source close is 10');
  assert(averageRes.points[0].value === '10', 'Test 9: Source average is 10 (20 quote / 2 qty)');
  assert(floorRes.points[0].value === '50', 'Test 9: Source floor is 50');

  console.log('✓ Test 9 passed: Explicit sources (close, average, floor) strictly separated');
}
  });
});
