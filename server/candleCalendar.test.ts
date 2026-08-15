import { getCandleRange } from './chartEngine';
import { Timeframe } from '../src/types/market';
import { test, describe } from 'vitest';

function assert(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message || ''}`);
  }
}

function assertThrows(fn: () => void, expectedMessagePart?: string) {
  let threw = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
    if (expectedMessagePart) {
      assert(
        err.message.includes(expectedMessagePart),
        `Expected error message to contain "${expectedMessagePart}", got "${err.message}"`
      );
    }
  }
  assert(threw, 'Expected function to throw an error');
}

describe('Candle Calendar Tests', () => {
  test('Scenario 1,2,3: 1s semi-open interval boundaries', () => {
    const startMs = Date.UTC(2026, 1, 15, 12, 0, 5, 0);
    const midMs = Date.UTC(2026, 1, 15, 12, 0, 5, 732);
    const lastMs = Date.UTC(2026, 1, 15, 12, 0, 5, 999);
    const nextMs = Date.UTC(2026, 1, 15, 12, 0, 6, 0);

    const rStart = getCandleRange(startMs, '1s');
    const rMid = getCandleRange(midMs, '1s');
    const rLast = getCandleRange(lastMs, '1s');
    const rNext = getCandleRange(nextMs, '1s');

    assert(rStart.startTime === startMs, '1s startMs startTime failed');
    assert(rStart.endTime === nextMs, '1s startMs endTime failed');

    assert(rMid.startTime === startMs, '1s midMs startTime failed');
    assert(rMid.endTime === nextMs, '1s midMs endTime failed');

    assert(rLast.startTime === startMs, '1s lastMs startTime failed');
    assert(rLast.endTime === nextMs, '1s lastMs endTime failed');

    assert(rNext.startTime === nextMs, '1s nextMs startTime failed');
    assert(rNext.endTime === nextMs + 1000, '1s nextMs endTime failed');
  });

  test('1m Timeframe Boundaries', () => {
    const tStart = Date.UTC(2026, 1, 15, 12, 34, 0, 0);
    const tMid = Date.UTC(2026, 1, 15, 12, 34, 45, 123);
    const tEnd = Date.UTC(2026, 1, 15, 12, 34, 59, 999);
    const tNext = Date.UTC(2026, 1, 15, 12, 35, 0, 0);

    const rStart = getCandleRange(tStart, '1m');
    const rMid = getCandleRange(tMid, '1m');
    const rEnd = getCandleRange(tEnd, '1m');
    const rNext = getCandleRange(tNext, '1m');

    assert(rStart.startTime === tStart, '1m start');
    assert(rStart.endTime === tNext, '1m start end');
    assert(rMid.startTime === tStart, '1m mid');
    assert(rEnd.startTime === tStart, '1m end');
    assert(rEnd.endTime === tNext, '1m end end');
    assert(rNext.startTime === tNext, '1m next');
  });

  test('5m Timeframe Boundaries', () => {
    const t1 = Date.UTC(2026, 1, 15, 12, 4, 59, 999);
    const t2 = Date.UTC(2026, 1, 15, 12, 5, 0, 0);

    const r1 = getCandleRange(t1, '5m');
    const r2 = getCandleRange(t2, '5m');

    assert(r1.startTime === Date.UTC(2026, 1, 15, 12, 0, 0, 0), '5m boundary 1');
    assert(r1.endTime === Date.UTC(2026, 1, 15, 12, 5, 0, 0), '5m boundary 1 end');
    assert(r2.startTime === Date.UTC(2026, 1, 15, 12, 5, 0, 0), '5m boundary 2');
    assert(r2.endTime === Date.UTC(2026, 1, 15, 12, 10, 0, 0), '5m boundary 2 end');
  });

  test('15m Timeframe Boundaries', () => {
    const testTimes = [
      {
        in: Date.UTC(2026, 1, 15, 12, 14, 59, 999),
        expectedStart: Date.UTC(2026, 1, 15, 12, 0, 0, 0),
      },
      {
        in: Date.UTC(2026, 1, 15, 12, 15, 0, 0),
        expectedStart: Date.UTC(2026, 1, 15, 12, 15, 0, 0),
      },
      {
        in: Date.UTC(2026, 1, 15, 12, 29, 59, 999),
        expectedStart: Date.UTC(2026, 1, 15, 12, 15, 0, 0),
      },
      {
        in: Date.UTC(2026, 1, 15, 12, 30, 0, 0),
        expectedStart: Date.UTC(2026, 1, 15, 12, 30, 0, 0),
      },
      {
        in: Date.UTC(2026, 1, 15, 12, 44, 59, 999),
        expectedStart: Date.UTC(2026, 1, 15, 12, 30, 0, 0),
      },
      {
        in: Date.UTC(2026, 1, 15, 12, 45, 0, 0),
        expectedStart: Date.UTC(2026, 1, 15, 12, 45, 0, 0),
      },
    ];

    for (const item of testTimes) {
      const res = getCandleRange(item.in, '15m');
      assert(res.startTime === item.expectedStart, `15m failed for ${item.in}`);
      assert(res.endTime === item.expectedStart + 900000, `15m duration failed for ${item.in}`);
    }
  });

  test('1h Timeframe Boundaries & Hour Transitions', () => {
    const t1 = Date.UTC(2026, 1, 15, 12, 0, 0, 0);
    const t2 = Date.UTC(2026, 1, 15, 12, 59, 59, 999);
    const t3 = Date.UTC(2026, 1, 15, 13, 0, 0, 0);

    const r1 = getCandleRange(t1, '1h');
    const r2 = getCandleRange(t2, '1h');
    const r3 = getCandleRange(t3, '1h');

    assert(r1.startTime === Date.UTC(2026, 1, 15, 12, 0, 0, 0), '1h t1');
    assert(r1.endTime === Date.UTC(2026, 1, 15, 13, 0, 0, 0), '1h t1 end');
    assert(r2.startTime === Date.UTC(2026, 1, 15, 12, 0, 0, 0), '1h t2');
    assert(r3.startTime === Date.UTC(2026, 1, 15, 13, 0, 0, 0), '1h t3');
  });

  test('4h Timeframe Boundaries', () => {
    const test4h = [
      {
        in: Date.UTC(2026, 1, 15, 3, 59, 59, 999),
        expectedStart: Date.UTC(2026, 1, 15, 0, 0, 0, 0),
      },
      { in: Date.UTC(2026, 1, 15, 4, 0, 0, 0), expectedStart: Date.UTC(2026, 1, 15, 4, 0, 0, 0) },
      {
        in: Date.UTC(2026, 1, 15, 7, 59, 59, 999),
        expectedStart: Date.UTC(2026, 1, 15, 4, 0, 0, 0),
      },
      { in: Date.UTC(2026, 1, 15, 8, 0, 0, 0), expectedStart: Date.UTC(2026, 1, 15, 8, 0, 0, 0) },
      {
        in: Date.UTC(2026, 1, 15, 23, 59, 59, 999),
        expectedStart: Date.UTC(2026, 1, 15, 20, 0, 0, 0),
      },
      { in: Date.UTC(2026, 1, 16, 0, 0, 0, 0), expectedStart: Date.UTC(2026, 1, 16, 0, 0, 0, 0) },
    ];

    for (const item of test4h) {
      const res = getCandleRange(item.in, '4h');
      assert(
        res.startTime === item.expectedStart,
        `4h failed for ${new Date(item.in).toISOString()}`
      );
      assert(res.endTime === item.expectedStart + 14400000, `4h duration failed for ${item.in}`);
    }
  });

  test('1d Timeframe Boundaries & UTC Midnight', () => {
    const t1 = Date.UTC(2026, 1, 15, 0, 0, 0, 0);
    const t2 = Date.UTC(2026, 1, 15, 23, 59, 59, 999);
    const t3 = Date.UTC(2026, 1, 16, 0, 0, 0, 0);

    const r1 = getCandleRange(t1, '1d');
    const r2 = getCandleRange(t2, '1d');
    const r3 = getCandleRange(t3, '1d');

    assert(r1.startTime === Date.UTC(2026, 1, 15, 0, 0, 0, 0), '1d t1');
    assert(r1.endTime === Date.UTC(2026, 1, 16, 0, 0, 0, 0), '1d t1 end');
    assert(r2.startTime === Date.UTC(2026, 1, 15, 0, 0, 0, 0), '1d t2');
    assert(r3.startTime === Date.UTC(2026, 1, 16, 0, 0, 0, 0), '1d t3');
  });

  test('1w ISO Week', () => {
    const mondayMs = Date.UTC(2026, 1, 16, 0, 0, 0, 0);
    const wednesdayMs = Date.UTC(2026, 1, 18, 15, 30, 0, 0);
    const sundayMs = Date.UTC(2026, 1, 22, 23, 59, 59, 999);
    const nextMondayMs = Date.UTC(2026, 1, 23, 0, 0, 0, 0);

    const rMon = getCandleRange(mondayMs, '1w');
    const rWed = getCandleRange(wednesdayMs, '1w');
    const rSun = getCandleRange(sundayMs, '1w');
    const rNextMon = getCandleRange(nextMondayMs, '1w');

    assert(rMon.startTime === mondayMs, '1w Monday start');
    assert(rMon.endTime === nextMondayMs, '1w Monday end');
    assert(rWed.startTime === mondayMs, '1w Wednesday start');
    assert(rSun.startTime === mondayMs, '1w Sunday start');
    assert(rSun.endTime === nextMondayMs, '1w Sunday end');
    assert(rNextMon.startTime === nextMondayMs, '1w Next Monday start');

    const dec31_2025 = Date.UTC(2025, 11, 31, 23, 59, 59, 999);
    const rYearBoundary = getCandleRange(dec31_2025, '1w');
    assert(
      rYearBoundary.startTime === Date.UTC(2025, 11, 29, 0, 0, 0, 0),
      '1w Year boundary start'
    );
    assert(rYearBoundary.endTime === Date.UTC(2026, 0, 5, 0, 0, 0, 0), '1w Year boundary end');
  });

  test('1M Calendar Month', () => {
    const feb2026 = Date.UTC(2026, 1, 15, 12, 0, 0, 0);
    const rFeb2026 = getCandleRange(feb2026, '1M');
    assert(rFeb2026.startTime === Date.UTC(2026, 1, 1, 0, 0, 0, 0), '1M Feb 2026 start');
    assert(rFeb2026.endTime === Date.UTC(2026, 2, 1, 0, 0, 0, 0), '1M Feb 2026 end');
    assert(
      rFeb2026.endTime - rFeb2026.startTime === 28 * 86400000,
      '1M Feb 2026 duration (28 days)'
    );

    const feb2024 = Date.UTC(2024, 1, 29, 10, 0, 0, 0);
    const rFeb2024 = getCandleRange(feb2024, '1M');
    assert(rFeb2024.startTime === Date.UTC(2024, 1, 1, 0, 0, 0, 0), '1M Feb 2024 start');
    assert(rFeb2024.endTime === Date.UTC(2024, 2, 1, 0, 0, 0, 0), '1M Feb 2024 end');
    assert(
      rFeb2024.endTime - rFeb2024.startTime === 29 * 86400000,
      '1M Feb 2024 duration (29 days)'
    );

    const dec2026 = Date.UTC(2026, 11, 31, 23, 59, 59, 999);
    const rDec2026 = getCandleRange(dec2026, '1M');
    assert(rDec2026.startTime === Date.UTC(2026, 11, 1, 0, 0, 0, 0), '1M Dec 2026 start');
    assert(rDec2026.endTime === Date.UTC(2027, 0, 1, 0, 0, 0, 0), '1M Dec 2026 end');
  });

  test('Distinction between 1m and 1M', () => {
    const ts = Date.UTC(2026, 1, 15, 12, 30, 45, 0);
    const r1m = getCandleRange(ts, '1m');
    const r1M = getCandleRange(ts, '1M');

    assert(r1m.endTime - r1m.startTime === 60000, '1m duration must be 60,000 ms');
    assert(
      r1M.endTime - r1M.startTime === 28 * 86400000,
      '1M duration must be 28 days for Feb 2026'
    );
    assert(r1m.startTime !== r1M.startTime, '1m and 1M startTimes must be completely distinct');
  });

  test('Invalid & Edge Case Input Validation', () => {
    assertThrows(() => getCandleRange(-1000, '1m'), 'Negative timestamps are not supported');
    assertThrows(
      () => getCandleRange(1710000000, '1m'),
      'Expected Unix timestamp in milliseconds, not seconds'
    );
    assertThrows(() => getCandleRange('1710000000000' as any, '1m'), 'Invalid timestamp type');
    assertThrows(() => getCandleRange(NaN, '1m'), 'Invalid timestamp value');
    assertThrows(() => getCandleRange(Infinity, '1m'), 'Invalid timestamp value');
    assertThrows(() => getCandleRange(-Infinity, '1m'), 'Invalid timestamp value');
    assertThrows(() => getCandleRange(1710000000000, '30m' as any), 'Invalid timeframe');

    const rangeEpoch = getCandleRange(0, '1m');
    assert(rangeEpoch.startTime === 0, 'Epoch start startTime must be 0');
    assert(rangeEpoch.endTime === 60000, 'Epoch start endTime must be 60000');
  });

  test('Determinism Test', () => {
    const ts = Date.UTC(2026, 5, 20, 18, 45, 22, 100);
    const timeframes: Timeframe[] = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];

    for (const tf of timeframes) {
      const res1 = getCandleRange(ts, tf);
      const res2 = getCandleRange(ts, tf);
      assert(
        res1.startTime === res2.startTime && res1.endTime === res2.endTime,
        `Determinism failed for ${tf}`
      );
    }
  });
});
