import { describe, it, expect, beforeEach } from 'vitest';
import { getCandleRange, updateCandle, createCandleFromSale } from './chartEngine';
import { CandleStore } from '../src/lib/realtimeStream';
import { clearMarketState, acceptCompletedSale, getMarketCandlesHistory, processSale } from './marketState';
import { GiftSale, GiftCandle, Timeframe } from '../src/types/market';

describe('Stage 2 Calendar & Revision Suite', () => {
  beforeEach(() => {
    clearMarketState();
  });

  describe('Candle Calendar Boundaries (UTC)', () => {
    it('minute boundary (1m)', () => {
      const ts = Date.UTC(2026, 1, 15, 12, 34, 56, 789);
      const range = getCandleRange(ts, '1m');
      expect(range.startTime).toBe(Date.UTC(2026, 1, 15, 12, 34, 0, 0));
      expect(range.endTime).toBe(Date.UTC(2026, 1, 15, 12, 35, 0, 0));
    });

    it('hour boundary (1h)', () => {
      const ts = Date.UTC(2026, 1, 15, 12, 34, 56, 789);
      const range = getCandleRange(ts, '1h');
      expect(range.startTime).toBe(Date.UTC(2026, 1, 15, 12, 0, 0, 0));
      expect(range.endTime).toBe(Date.UTC(2026, 1, 15, 13, 0, 0, 0));
    });

    it('day boundary (1d)', () => {
      const ts = Date.UTC(2026, 1, 15, 12, 34, 56, 789);
      const range = getCandleRange(ts, '1d');
      expect(range.startTime).toBe(Date.UTC(2026, 1, 15, 0, 0, 0, 0));
      expect(range.endTime).toBe(Date.UTC(2026, 1, 16, 0, 0, 0, 0));
    });

    it('ISO-week boundary (1w) starting Monday 00:00:00 UTC', () => {
      // 2026-02-18 is Wednesday
      const wed = Date.UTC(2026, 1, 18, 15, 0, 0, 0);
      const rangeWed = getCandleRange(wed, '1w');
      expect(rangeWed.startTime).toBe(Date.UTC(2026, 1, 16, 0, 0, 0, 0)); // Monday Feb 16
      expect(rangeWed.endTime).toBe(Date.UTC(2026, 1, 23, 0, 0, 0, 0)); // Monday Feb 23

      // 2026-02-22 is Sunday
      const sun = Date.UTC(2026, 1, 22, 23, 59, 59, 999);
      const rangeSun = getCandleRange(sun, '1w');
      expect(rangeSun.startTime).toBe(Date.UTC(2026, 1, 16, 0, 0, 0, 0));
      expect(rangeSun.endTime).toBe(Date.UTC(2026, 1, 23, 0, 0, 0, 0));
    });

    it('month boundary (1M) calendar month', () => {
      const ts = Date.UTC(2026, 1, 15, 12, 0, 0, 0); // Feb 15 2026
      const range = getCandleRange(ts, '1M');
      expect(range.startTime).toBe(Date.UTC(2026, 1, 1, 0, 0, 0, 0)); // Feb 1
      expect(range.endTime).toBe(Date.UTC(2026, 2, 1, 0, 0, 0, 0)); // Mar 1
    });

    it('1m and 1M isolation', () => {
      const ts = Date.UTC(2026, 1, 15, 12, 34, 56, 789);
      const range1m = getCandleRange(ts, '1m');
      const range1M = getCandleRange(ts, '1M');

      expect(range1m.endTime - range1m.startTime).toBe(60000);
      expect(range1M.endTime - range1M.startTime).toBe(28 * 86400000);
      expect(range1m.startTime).not.toBe(range1M.startTime);
    });
  });

  describe('Revision Rules & Conflict Detection', () => {
    const instKey = 'pepe:all:all:TON';

    it('larger revision is applied', () => {
      const store = new CandleStore(instKey, '1m');
      const c1: GiftCandle = {
        instrumentKey: instKey,
        timeframe: '1m',
        startTime: 1000000,
        endTime: 1060000,
        open: '10', high: '10', low: '10', close: '10', volume: '1', quoteVolume: '10',
        tradeCount: 1, firstSaleId: 's1', lastSaleId: 's1', confirmed: false,
        revision: 1, updatedAt: 1000000
      };
      const res1 = store.applyCandle(c1);
      expect(res1.updated).toBe(true);

      const c2: GiftCandle = { ...c1, revision: 2, close: '15', high: '15', volume: '2', quoteVolume: '25', tradeCount: 2, updatedAt: 1000010 };
      const res2 = store.applyCandle(c2);
      expect(res2.updated).toBe(true);
      expect(store.getSortedCandles()[0].close).toBe('15');
      expect(store.getSortedCandles()[0].revision).toBe(2);
    });

    it('smaller revision is ignored (stale update)', () => {
      const store = new CandleStore(instKey, '1m');
      const c2: GiftCandle = {
        instrumentKey: instKey, timeframe: '1m', startTime: 1000000, endTime: 1060000,
        open: '10', high: '15', low: '10', close: '15', volume: '2', quoteVolume: '25',
        tradeCount: 2, firstSaleId: 's1', lastSaleId: 's2', confirmed: false,
        revision: 2, updatedAt: 1000010
      };
      store.applyCandle(c2);

      const c1: GiftCandle = { ...c2, revision: 1, close: '10', updatedAt: 1000000 };
      const res = store.applyCandle(c1);
      expect(res.updated).toBe(false);
      expect(store.getSortedCandles()[0].revision).toBe(2);
      expect(store.getSortedCandles()[0].close).toBe('15');
    });

    it('equal revision with same data is ignored', () => {
      const store = new CandleStore(instKey, '1m');
      const c1: GiftCandle = {
        instrumentKey: instKey, timeframe: '1m', startTime: 1000000, endTime: 1060000,
        open: '10', high: '10', low: '10', close: '10', volume: '1', quoteVolume: '10',
        tradeCount: 1, firstSaleId: 's1', lastSaleId: 's1', confirmed: false,
        revision: 1, updatedAt: 1000000
      };
      store.applyCandle(c1);

      const c1Dup = { ...c1 };
      const res = store.applyCandle(c1Dup);
      expect(res.updated).toBe(false);
      expect(res.conflict).toBeUndefined();
    });

    it('equal revision with different data is flagged as conflict', () => {
      const store = new CandleStore(instKey, '1m');
      const c1: GiftCandle = {
        instrumentKey: instKey, timeframe: '1m', startTime: 1000000, endTime: 1060000,
        open: '10', high: '10', low: '10', close: '10', volume: '1', quoteVolume: '10',
        tradeCount: 1, firstSaleId: 's1', lastSaleId: 's1', confirmed: false,
        revision: 1, updatedAt: 1000000
      };
      store.applyCandle(c1);

      const c1Conflict: GiftCandle = { ...c1, close: '99', high: '99' };
      const res = store.applyCandle(c1Conflict);
      expect(res.updated).toBe(false);
      expect(res.conflict).toBe(true);
      expect(store.getSortedCandles()[0].close).toBe('10'); // original value preserved
    });

    it('duplicate sale does not increase revision', () => {
      const sale1: GiftSale = {
        id: 'sale_dup_1', collectionId: 'pepe', price: '10', quantity: '1',
        currency: 'TON', eventTime: 1710000000000, createdAt: 1710000000000, status: 'completed'
      };

      const res1 = acceptCompletedSale(sale1);
      expect(res1.accepted).toBe(true);
      const rev1 = res1.candles?.find(c => c.timeframe === '1m')?.revision;
      expect(rev1).toBe(1);

      const res2 = acceptCompletedSale(sale1);
      expect(res2.accepted).toBe(false);
      expect(res2.reason).toBe('duplicate');

      const history = getMarketCandlesHistory('pepe:all:all:TON', '1m');
      expect(history.candles[0].revision).toBe(1);
    });

    it('late sale corrects the correct historical candle and increments revision', () => {
      const baseTime = 1710000000000; // e.g. 12:00:00

      // Sale 1 at 12:00:10
      const s1: GiftSale = {
        id: 'sale_1', collectionId: 'pepe', price: '10', quantity: '1',
        currency: 'TON', eventTime: baseTime + 10000, createdAt: baseTime + 10000, status: 'completed'
      };
      acceptCompletedSale(s1);

      // Sale 2 at 12:02:10 (advances active candle to 12:02 and closes 12:00 candle)
      const s2: GiftSale = {
        id: 'sale_2', collectionId: 'pepe', price: '20', quantity: '1',
        currency: 'TON', eventTime: baseTime + 130000, createdAt: baseTime + 130000, status: 'completed'
      };
      acceptCompletedSale(s2);

      // Late sale at 12:00:30 (belongs to closed 12:00 candle)
      const sLate: GiftSale = {
        id: 'sale_late', collectionId: 'pepe', price: '25', quantity: '1',
        currency: 'TON', eventTime: baseTime + 30000, createdAt: baseTime + 30000, status: 'completed'
      };
      const resLate = acceptCompletedSale(sLate);
      expect(resLate.accepted).toBe(true);

      const history = getMarketCandlesHistory('pepe:all:all:TON', '1m');
      const candle1200 = history.candles.find(c => c.startTime === baseTime);
      expect(candle1200).toBeDefined();
      expect(candle1200?.high).toBe('25'); // updated high
      expect(candle1200?.revision).toBe(2); // revision incremented from 1 to 2
      expect(candle1200?.tradeCount).toBe(2);
    });
  });
});
