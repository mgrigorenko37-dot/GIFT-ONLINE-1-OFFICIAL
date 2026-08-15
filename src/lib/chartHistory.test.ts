import { describe, it, expect } from 'vitest';
import { processCandlesForChart } from './chartHistory';
import { GiftCandle, Timeframe, buildInstrumentKey } from '../types/market';

describe('Stage 7: REST History & Chart Data Processing', () => {
  const ALL_TIMEFRAMES: Timeframe[] = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];

  it('1. Supports and validates all 9 timeframes without error', () => {
    for (const tf of ALL_TIMEFRAMES) {
      const mockCandle: GiftCandle = {
        instrumentKey: 'durov-cap:all:all:TON',
        timeframe: tf,
        startTime: 1710000000000,
        endTime: 1710000060000,
        open: '10.5',
        high: '12.0',
        low: '9.8',
        close: '11.2',
        volume: '100',
        quoteVolume: '1100',
        tradeCount: 5,
        confirmed: true,
        revision: 1,
        updatedAt: 1710000060000,
      };

      const result = processCandlesForChart([mockCandle], tf);
      expect(result.length).toBe(1);
      expect(result[0].time).toBe(1710000000); // 1710000000000 ms -> 1710000000 s
      expect(result[0].open).toBe(10.5);
      expect(result[0].close).toBe(11.2);
    }
  });

  it('2. Correctly converts ms to seconds without double conversion', () => {
    const msTime = 1710000000000;
    const candle: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1m',
      startTime: msTime,
      endTime: msTime + 60000,
      open: '100',
      high: '105',
      low: '95',
      close: '102',
      volume: '10',
      quoteVolume: '1000',
      tradeCount: 1,
      confirmed: true,
      revision: 1,
      updatedAt: msTime + 60000,
    };

    const result = processCandlesForChart([candle], '1m');
    expect(result[0].time).toBe(1710000000);
    expect(result[0].time).not.toBe(1710000000000);
  });

  it('3. Strictly isolates 1m and 1M timeframes and rejects mixed timeframe data', () => {
    const candle1m: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1m',
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '11',
      low: '9',
      close: '10.5',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      confirmed: true,
      revision: 1,
      updatedAt: 1710000060000,
    };

    const candle1M: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1M',
      startTime: 1710000000000,
      endTime: 1712678400000,
      open: '10',
      high: '50',
      low: '8',
      close: '45',
      volume: '1000',
      quoteVolume: '30000',
      tradeCount: 100,
      confirmed: false,
      revision: 10,
      updatedAt: 1710000060000,
    };

    // Asking for 1m should ONLY include 1m candle
    const res1m = processCandlesForChart([candle1m, candle1M], '1m');
    expect(res1m.length).toBe(1);
    expect(res1m[0].close).toBe(10.5);

    // Asking for 1M should ONLY include 1M candle
    const res1M = processCandlesForChart([candle1m, candle1M], '1M');
    expect(res1M.length).toBe(1);
    expect(res1M[0].close).toBe(45);
  });

  it('4. Handles empty history gracefully returning empty array', () => {
    expect(processCandlesForChart([], '1m')).toEqual([]);
    expect(processCandlesForChart(null as any, '1m')).toEqual([]);
  });

  it('5. Handles exact string prices and parses them correctly for chart', () => {
    const candle: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '5m',
      startTime: 1710000000000,
      endTime: 1710000300000,
      open: '100.12345678',
      high: '105.99999999',
      low: '99.00000001',
      close: '104.50000000',
      volume: '5.5',
      quoteVolume: '560',
      tradeCount: 2,
      confirmed: true,
      revision: 1,
      updatedAt: 1710000300000,
    };

    const result = processCandlesForChart([candle], '5m');
    expect(result[0].open).toBe(100.12345678);
    expect(result[0].high).toBe(105.99999999);
    expect(result[0].low).toBe(99.00000001);
    expect(result[0].close).toBe(104.5);
  });

  it('6. Removes duplicates by startTime and sorts strictly ASC', () => {
    const c1: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1m',
      startTime: 1710000060000, // second
      endTime: 1710000120000,
      open: '10',
      high: '11',
      low: '9',
      close: '10',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      confirmed: true,
      revision: 1,
      updatedAt: 1710000120000,
    };

    const c2Old: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1m',
      startTime: 1710000000000, // first (old rev)
      endTime: 1710000060000,
      open: '10',
      high: '10',
      low: '10',
      close: '10',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      confirmed: false,
      revision: 1,
      updatedAt: 1710000030000,
    };

    const c2New: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1m',
      startTime: 1710000000000, // first (new rev)
      endTime: 1710000060000,
      open: '10',
      high: '15',
      low: '10',
      close: '14',
      volume: '2',
      quoteVolume: '24',
      tradeCount: 2,
      confirmed: true,
      revision: 2,
      updatedAt: 1710000060000,
    };

    // Pass in unsorted order with duplicate startTime
    const result = processCandlesForChart([c1, c2Old, c2New], '1m');

    expect(result.length).toBe(2);
    // Should be sorted by time ASC
    expect(result[0].time).toBe(1710000000);
    expect(result[1].time).toBe(1710000060);
    // Duplicate 1710000000 should use c2New (revision 2)
    expect(result[0].high).toBe(15);
    expect(result[0].close).toBe(14);
  });

  it('7. Handles timeframe switching correctly', () => {
    const candles: GiftCandle[] = [
      {
        instrumentKey: 'durov-cap:all:all:TON',
        timeframe: '1h',
        startTime: 1710000000000,
        endTime: 1710003600000,
        open: '10',
        high: '20',
        low: '5',
        close: '15',
        volume: '10',
        quoteVolume: '150',
        tradeCount: 5,
        confirmed: true,
        revision: 1,
        updatedAt: 1710003600000,
      },
    ];

    // Requesting '4h' for '1h' candles should yield 0 candles (no mixup)
    expect(processCandlesForChart(candles, '4h')).toEqual([]);
    // Requesting '1h' should yield 1 candle
    expect(processCandlesForChart(candles, '1h').length).toBe(1);
  });

  it('8 & 9. Supports both TON and STARS instrument keys', () => {
    const tonKey = buildInstrumentKey({ collectionId: 'pepe-hat', currency: 'TON' });
    const starsKey = buildInstrumentKey({ collectionId: 'pepe-hat', currency: 'STARS' });

    expect(tonKey).toBe('pepe-hat:all:all:TON');
    expect(starsKey).toBe('pepe-hat:all:all:STARS');

    const tonCandle: GiftCandle = {
      instrumentKey: tonKey,
      timeframe: '1d',
      startTime: 1710000000000,
      endTime: 1710086400000,
      open: '5.5',
      high: '6.0',
      low: '5.0',
      close: '5.8',
      volume: '100',
      quoteVolume: '580',
      tradeCount: 10,
      confirmed: true,
      revision: 1,
      updatedAt: 1710086400000,
    };

    const starsCandle: GiftCandle = {
      instrumentKey: starsKey,
      timeframe: '1d',
      startTime: 1710000000000,
      endTime: 1710086400000,
      open: '500',
      high: '600',
      low: '500',
      close: '580',
      volume: '100',
      quoteVolume: '58000',
      tradeCount: 10,
      confirmed: true,
      revision: 1,
      updatedAt: 1710086400000,
    };

    const tonRes = processCandlesForChart([tonCandle], '1d');
    expect(tonRes[0].close).toBe(5.8);

    const starsRes = processCandlesForChart([starsCandle], '1d');
    expect(starsRes[0].close).toBe(580);
  });
});
