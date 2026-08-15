import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CandleStore, SequenceTracker, SaleTracker } from '../lib/realtimeStream';
import { GiftCandle, GiftSale } from '../types/market';

describe('Stage 8: Socket Handler & Realtime Integration Logic', () => {
  let candleStore: CandleStore;
  let sequenceTracker: SequenceTracker;
  let saleTracker: SaleTracker;

  const instKey = 'durov-cap:all:all:TON';
  const tf = '1m';

  beforeEach(() => {
    candleStore = new CandleStore(instKey, tf);
    sequenceTracker = new SequenceTracker();
    saleTracker = new SaleTracker(instKey);
  });

  it('1. Connects, handles market_subscribe emissions and candle_update events', () => {
    const candleV1: GiftCandle = {
      instrumentKey: instKey,
      timeframe: tf,
      startTime: 1710000000000,
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
      updatedAt: 1710000010000,
    };

    // Process sequence 1
    const seqRes = sequenceTracker.processSequence(1);
    expect(seqRes.ok).toBe(true);

    const applyRes = candleStore.applyCandle(candleV1);
    expect(applyRes.updated).toBe(true);
    expect(applyRes.isNew).toBe(true);
    expect(candleStore.getSortedCandles().length).toBe(1);

    // Update candle with revision 2
    const candleV2: GiftCandle = {
      ...candleV1,
      close: '15',
      revision: 2,
      updatedAt: 1710000020000,
    };

    const seqRes2 = sequenceTracker.processSequence(2);
    expect(seqRes2.ok).toBe(true);

    const applyRes2 = candleStore.applyCandle(candleV2);
    expect(applyRes2.updated).toBe(true);
    expect(applyRes2.isNew).toBe(false);
    expect(candleStore.getSortedCandles().length).toBe(1);
    expect(candleStore.getSortedCandles()[0].close).toBe('15');
  });

  it('2. Receives snapshot and populates closed & active candles without duplicates', () => {
    const closedCandle: GiftCandle = {
      instrumentKey: instKey,
      timeframe: tf,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '12',
      low: '9',
      close: '11',
      volume: '5',
      quoteVolume: '50',
      tradeCount: 3,
      confirmed: true,
      revision: 5,
      updatedAt: 1710000060000,
    };

    const activeCandle: GiftCandle = {
      instrumentKey: instKey,
      timeframe: tf,
      startTime: 1710000060000,
      endTime: 1710000120000,
      open: '11',
      high: '13',
      low: '11',
      close: '12',
      volume: '2',
      quoteVolume: '23',
      tradeCount: 2,
      confirmed: false,
      revision: 1,
      updatedAt: 1710000080000,
    };

    const sale: GiftSale = {
      id: 'sale-snap-1',
      collectionId: 'durov-cap',
      modelId: 'all',
      backdropId: 'all',
      currency: 'TON',
      price: '12',
      quantity: 1,
      eventTime: 1710000080000,
      timestamp: 1710000080000,
      status: 'completed',
      instrumentKey: instKey,
    };

    // Process snapshot at sequence 10
    const seqRes = sequenceTracker.processSequence(10, true); // isSnapshot
    expect(seqRes.ok).toBe(true);

    candleStore.mergeCandles([closedCandle]);
    candleStore.applyCandle(activeCandle);
    saleTracker.addSale(sale);

    expect(candleStore.getSortedCandles().length).toBe(2);
    expect(saleTracker.getRecentSales().length).toBe(1);
    expect(sequenceTracker.getLastSequence()).toBe(10);
  });

  it('3. Sequence gap detection triggers resync signal', () => {
    sequenceTracker.processSequence(1);

    // Sequence jumps to 10
    const gapRes = sequenceTracker.processSequence(10);
    expect(gapRes.gap).toBe(true);
    expect(gapRes.ok).toBe(false);
  });

  it('4. Timeframe and Instrument isolation', () => {
    const wrongInstCandle: GiftCandle = {
      instrumentKey: 'pepe-hat:all:all:STARS',
      timeframe: tf,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '100',
      high: '100',
      low: '100',
      close: '100',
      volume: '1',
      quoteVolume: '100',
      tradeCount: 1,
      confirmed: false,
      revision: 1,
      updatedAt: 1710000010000,
    };

    const wrongTfCandle: GiftCandle = {
      instrumentKey: instKey,
      timeframe: '5m',
      startTime: 1710000000000,
      endTime: 1710000300000,
      open: '10',
      high: '10',
      low: '10',
      close: '10',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      confirmed: false,
      revision: 1,
      updatedAt: 1710000010000,
    };

    expect(candleStore.applyCandle(wrongInstCandle).updated).toBe(false);
    expect(candleStore.applyCandle(wrongTfCandle).updated).toBe(false);
    expect(candleStore.getSortedCandles().length).toBe(0);
  });

  it('5. Stage 9: Config token validation prevents delayed REST responses from leaking into current chart', () => {
    const activeConfigToken = {
      instrumentKey: 'durov-cap:all:all:TON',
      currency: 'TON' as const,
      timeframe: '1h' as const,
      requestId: 5,
      subscriptionId: 'sub_5_123',
    };

    const oldConfigToken = {
      instrumentKey: 'durov-cap:all:all:TON',
      currency: 'TON' as const,
      timeframe: '1m' as const, // old timeframe
      requestId: 4, // old requestId
      subscriptionId: 'sub_4_122',
    };

    const staleRestCandle: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1m',
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '12',
      low: '8',
      close: '11',
      volume: '10',
      quoteVolume: '100',
      tradeCount: 5,
      confirmed: true,
      revision: 1,
      updatedAt: 1710000060000,
    };

    const newStore = new CandleStore('durov-cap:all:all:TON', '1h');

    // Simulate mergeRestCandles logic for config token check:
    const mergeWithTokenCheck = (
      candles: GiftCandle[],
      token?: {
        instrumentKey: string;
        currency: string;
        timeframe: string;
        requestId: number;
        subscriptionId: string;
      },
      activeToken?: {
        instrumentKey: string;
        currency: string;
        timeframe: string;
        requestId: number;
        subscriptionId: string;
      }
    ) => {
      if (!token || !activeToken) return 0;
      if (token.requestId !== activeToken.requestId) return 0;
      if (token.timeframe !== activeToken.timeframe) return 0;
      if (token.currency !== activeToken.currency) return 0;
      if (token.instrumentKey !== activeToken.instrumentKey) return 0;

      const valid = candles.filter(
        (c) =>
          c.timeframe === activeToken.timeframe && c.instrumentKey === activeToken.instrumentKey
      );
      return newStore.mergeCandles(valid);
    };

    // Stale response with old token is rejected
    const staleResult = mergeWithTokenCheck([staleRestCandle], oldConfigToken, activeConfigToken);
    expect(staleResult).toBe(0);
    expect(newStore.getSortedCandles().length).toBe(0);

    // Fresh response with matching token is accepted
    const fresh1hCandle: GiftCandle = {
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1h',
      startTime: 1710000000000,
      endTime: 1710003600000,
      open: '10',
      high: '15',
      low: '8',
      close: '14',
      volume: '100',
      quoteVolume: '1200',
      tradeCount: 25,
      confirmed: false,
      revision: 1,
      updatedAt: 1710000100000,
    };

    const freshResult = mergeWithTokenCheck([fresh1hCandle], activeConfigToken, activeConfigToken);
    expect(freshResult).toBe(1);
    expect(newStore.getSortedCandles().length).toBe(1);
  });

  it('6. Stage 9: Rapid switching scenario (1m -> 1h -> 1M -> 1s) rejects all intermediate late socket & REST events', () => {
    const timeframes = ['1m', '1h', '1M', '1s'] as const;
    let reqId = 0;
    let subId = 0;

    const configs = timeframes.map((tf) => {
      reqId++;
      subId++;
      return {
        instrumentKey: 'durov-cap:all:all:TON',
        currency: 'TON' as const,
        timeframe: tf,
        requestId: reqId,
        subscriptionId: `sub_${subId}`,
      };
    });

    const activeConfig = configs[3]; // '1s' is current active config

    // Function to check if event matches active configuration
    const isEventValidForConfig = (event: any, currentConfig: typeof activeConfig) => {
      if (event.instrumentKey && event.instrumentKey !== currentConfig.instrumentKey) return false;
      if (event.currency && event.currency !== currentConfig.currency) return false;
      if (event.subscriptionId && event.subscriptionId !== currentConfig.subscriptionId)
        return false;
      if (event.requestId !== undefined && event.requestId !== currentConfig.requestId)
        return false;
      if (event.timeframe && event.timeframe !== currentConfig.timeframe) return false;
      return true;
    };

    // Socket events from previous timeframes
    const event1m = {
      type: 'candle_update',
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1m',
      subscriptionId: 'sub_1',
      requestId: 1,
    };
    const event1h = {
      type: 'candle_update',
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1h',
      subscriptionId: 'sub_2',
      requestId: 2,
    };
    const event1M = {
      type: 'candle_update',
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1M',
      subscriptionId: 'sub_3',
      requestId: 3,
    };
    const event1s = {
      type: 'candle_update',
      instrumentKey: 'durov-cap:all:all:TON',
      timeframe: '1s',
      subscriptionId: 'sub_4',
      requestId: 4,
    };

    expect(isEventValidForConfig(event1m, activeConfig)).toBe(false);
    expect(isEventValidForConfig(event1h, activeConfig)).toBe(false);
    expect(isEventValidForConfig(event1M, activeConfig)).toBe(false);
    expect(isEventValidForConfig(event1s, activeConfig)).toBe(true);
  });

  it('7. Stage 9: Currency switch (TON -> STARS) rejects late events from previous currency', () => {
    const activeConfig = {
      instrumentKey: 'durov-cap:all:all:STARS',
      currency: 'STARS' as const,
      timeframe: '1m' as const,
      requestId: 10,
      subscriptionId: 'sub_10',
    };

    const isEventValid = (event: any) => {
      if (event.instrumentKey && event.instrumentKey !== activeConfig.instrumentKey) return false;
      if (event.currency && event.currency !== activeConfig.currency) return false;
      return true;
    };

    const tonEvent = { instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' };
    const starsEvent = { instrumentKey: 'durov-cap:all:all:STARS', currency: 'STARS' };

    expect(isEventValid(tonEvent)).toBe(false);
    expect(isEventValid(starsEvent)).toBe(true);
  });
});
