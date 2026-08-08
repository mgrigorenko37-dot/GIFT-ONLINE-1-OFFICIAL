import { describe, it, expect, beforeEach } from 'vitest';
import { CandleStore, SequenceTracker, SaleTracker } from './realtimeStream';
import { GiftCandle, GiftSale, Timeframe } from '../types/market';

describe('Stage 8: Realtime Stream & Socket Data Rules', () => {
  let candleStore: CandleStore;
  let sequenceTracker: SequenceTracker;
  let saleTracker: SaleTracker;

  const instA = 'durov-cap:all:all:TON';
  const instB = 'pepe-hat:all:all:STARS';
  const tf1m: Timeframe = '1m';
  const tf1M: Timeframe = '1M';

  beforeEach(() => {
    candleStore = new CandleStore(instA, tf1m);
    sequenceTracker = new SequenceTracker();
    saleTracker = new SaleTracker(instA);
  });

  it('1. Realtime update of active candle replaces candle by startTime without duplicating', () => {
    const candleV1: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '10', low: '10', close: '10',
      volume: '1', quoteVolume: '10', tradeCount: 1,
      confirmed: false, revision: 1, updatedAt: 1710000010000
    };

    const candleV2: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '12', low: '10', close: '11.5',
      volume: '2', quoteVolume: '21.5', tradeCount: 2,
      confirmed: false, revision: 2, updatedAt: 1710000020000
    };

    const res1 = candleStore.applyCandle(candleV1);
    expect(res1.updated).toBe(true);
    expect(res1.isNew).toBe(true);
    expect(candleStore.getSortedCandles().length).toBe(1);

    const res2 = candleStore.applyCandle(candleV2);
    expect(res2.updated).toBe(true);
    expect(res2.isNew).toBe(false);
    expect(candleStore.getSortedCandles().length).toBe(1); // No duplicate!
    expect(candleStore.getSortedCandles()[0].close).toBe('11.5');
  });

  it('2. candle_closed updates candle and marks it confirmed=true', () => {
    const active: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '12', low: '9', close: '11',
      volume: '5', quoteVolume: '50', tradeCount: 3,
      confirmed: false, revision: 3, updatedAt: 1710000050000
    };

    const closed: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '13', low: '9', close: '12.5',
      volume: '6', quoteVolume: '62.5', tradeCount: 4,
      confirmed: true, revision: 4, updatedAt: 1710000060000
    };

    candleStore.applyCandle(active);
    candleStore.applyCandle(closed);

    const candles = candleStore.getSortedCandles();
    expect(candles.length).toBe(1);
    expect(candles[0].confirmed).toBe(true);
    expect(candles[0].close).toBe('12.5');
  });

  it('3. Rejects duplicate event and stale revision', () => {
    const candleV2: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '15', low: '9', close: '14',
      volume: '10', quoteVolume: '140', tradeCount: 5,
      confirmed: false, revision: 2, updatedAt: 1710000030000
    };

    const candleV1Stale: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '10', low: '10', close: '10',
      volume: '1', quoteVolume: '10', tradeCount: 1,
      confirmed: false, revision: 1, updatedAt: 1710000010000
    };

    candleStore.applyCandle(candleV2);

    // Stale revision 1 arriving after revision 2
    const resStale = candleStore.applyCandle(candleV1Stale);
    expect(resStale.updated).toBe(false);
    expect(candleStore.getSortedCandles()[0].revision).toBe(2);

    // Exact duplicate revision 2 arriving again
    const resDup = candleStore.applyCandle(candleV2);
    expect(resDup.updated).toBe(false);
  });

  it('4. Handles sequence gaps correctly and triggers gap detection', () => {
    // Event 1
    const res1 = sequenceTracker.processSequence(100);
    expect(res1.ok).toBe(true);
    expect(res1.gap).toBe(false);

    // Event 2 (consecutive)
    const res2 = sequenceTracker.processSequence(101);
    expect(res2.ok).toBe(true);

    // Stale Event (100 again)
    const resStale = sequenceTracker.processSequence(100);
    expect(resStale.ok).toBe(false);
    expect(resStale.reason).toBe('stale_sequence');

    // Sequence gap (jumps from 101 to 105)
    const resGap = sequenceTracker.processSequence(105);
    expect(resGap.ok).toBe(false);
    expect(resGap.gap).toBe(true);
    expect(resGap.reason).toBe('sequence_gap');

    // Snapshot resets sequence tracker
    const resSnap = sequenceTracker.processSequence(105, true); // isSnapshot
    expect(resSnap.ok).toBe(true);
    expect(resSnap.gap).toBe(false);
    expect(sequenceTracker.getLastSequence()).toBe(105);
  });

  it('5. Enforces timeframe isolation (1m vs 1M)', () => {
    const candle1m: GiftCandle = {
      instrumentKey: instA,
      timeframe: '1m',
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '11', low: '9', close: '10.5',
      volume: '1', quoteVolume: '10.5', tradeCount: 1,
      confirmed: true, revision: 1, updatedAt: 1710000060000
    };

    const candle1M: GiftCandle = {
      instrumentKey: instA,
      timeframe: '1M',
      startTime: 1710000000000,
      endTime: 1712678400000,
      open: '10', high: '100', low: '5', close: '80',
      volume: '500', quoteVolume: '40000', tradeCount: 200,
      confirmed: false, revision: 10, updatedAt: 1710000060000
    };

    // Store is set to 1m, so 1M candle must be rejected
    const res1M = candleStore.applyCandle(candle1M);
    expect(res1M.updated).toBe(false);
    expect(candleStore.getSortedCandles().length).toBe(0);

    const res1m = candleStore.applyCandle(candle1m);
    expect(res1m.updated).toBe(true);
    expect(candleStore.getSortedCandles().length).toBe(1);
  });

  it('6. Enforces instrument key isolation (TON vs STARS, Gift A vs Gift B)', () => {
    const candleA: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '11', low: '9', close: '10.5',
      volume: '1', quoteVolume: '10.5', tradeCount: 1,
      confirmed: true, revision: 1, updatedAt: 1710000060000
    };

    const candleB: GiftCandle = {
      instrumentKey: instB,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '100', high: '110', low: '90', close: '105',
      volume: '1', quoteVolume: '105', tradeCount: 1,
      confirmed: true, revision: 1, updatedAt: 1710000060000
    };

    // Store expects instA, so candleB must be ignored
    expect(candleStore.applyCandle(candleB).updated).toBe(false);
    expect(candleStore.applyCandle(candleA).updated).toBe(true);
    expect(candleStore.getSortedCandles().length).toBe(1);
    expect(candleStore.getSortedCandles()[0].instrumentKey).toBe(instA);
  });

  it('7. SaleTracker deduplicates sales and enforces instrument isolation', () => {
    const saleA1: GiftSale = {
      id: 'sale-1',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '10.5',
      quantity: 1,
      eventTime: 1710000010000,
      timestamp: 1710000010000,
      status: 'completed',
      instrumentKey: instA
    };

    const saleA1Dup: GiftSale = { ...saleA1 };

    const saleB1: GiftSale = {
      id: 'sale-2',
      collectionId: 'pepe-hat',
      modelId: 'all',
      backdropId: 'all',
      currency: 'STARS',
      price: '500',
      quantity: 1,
      eventTime: 1710000015000,
      timestamp: 1710000015000,
      status: 'completed',
      instrumentKey: instB
    };

    expect(saleTracker.addSale(saleA1)).toBe(true);
    expect(saleTracker.addSale(saleA1Dup)).toBe(false); // Duplicate rejected
    expect(saleTracker.addSale(saleB1)).toBe(false); // Wrong instrument key rejected

    const sales = saleTracker.getRecentSales();
    expect(sales.length).toBe(1);
    expect(sales[0].id).toBe('sale-1');
  });
});
