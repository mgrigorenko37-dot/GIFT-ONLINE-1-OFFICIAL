import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { processTelegramMarketEvent, RawTelegramMarketEvent } from './telegramAdapter';
import { clearMarketState, allSales, getMarketCandlesHistory } from './marketState';
import { simulateSales } from './mockMinter';

describe('Stage 3 Telegram Sales Adapter & Ingestion Pipeline', () => {
  beforeEach(() => {
    clearMarketState();
  });

  describe('1. Webhook Payload Validation & Normalization', () => {
    it('rejects malformed payloads (null, primitive, non-object)', () => {
      expect(processTelegramMarketEvent(null).success).toBe(false);
      expect(processTelegramMarketEvent(undefined).success).toBe(false);
      expect(processTelegramMarketEvent("string_payload").success).toBe(false);
      expect(processTelegramMarketEvent(12345).success).toBe(false);
      expect(processTelegramMarketEvent([]).success).toBe(false);
    });

    it('rejects missing collectionId', () => {
      const payload = {
        sale_id: 'sale_1',
        currency: 'TON',
        price: '100',
        event_time: 1770000000000,
        status: 'completed'
      };
      const res = processTelegramMarketEvent(payload);
      expect(res.success).toBe(false);
      expect(res.reason).toContain('collectionId is required');
    });

    it('rejects invalid or negative price', () => {
      const p1 = { collection_id: 'cap', sale_id: 's1', currency: 'TON', price: '0', event_time: 1770000000000 };
      const p2 = { collection_id: 'cap', sale_id: 's2', currency: 'TON', price: '-10', event_time: 1770000000000 };
      const p3 = { collection_id: 'cap', sale_id: 's3', currency: 'TON', price: 'abc', event_time: 1770000000000 };

      expect(processTelegramMarketEvent(p1).success).toBe(false);
      expect(processTelegramMarketEvent(p2).success).toBe(false);
      expect(processTelegramMarketEvent(p3).success).toBe(false);
    });

    it('rejects invalid or negative quantity', () => {
      const p1 = { collection_id: 'cap', sale_id: 's1', currency: 'TON', price: '100', quantity: '0', event_time: 1770000000000 };
      const p2 = { collection_id: 'cap', sale_id: 's2', currency: 'TON', price: '100', quantity: '-1', event_time: 1770000000000 };

      expect(processTelegramMarketEvent(p1).success).toBe(false);
      expect(processTelegramMarketEvent(p2).success).toBe(false);
    });

    it('validates currency (only TON or STARS allowed)', () => {
      const validTon = { collection_id: 'cap', sale_id: 's1', currency: 'ton', price: '100', event_time: 1770000000000 };
      const validStars = { collection_id: 'cap', sale_id: 's2', currency: 'STARS', price: '100', event_time: 1770000000000 };
      const invalidBtc = { collection_id: 'cap', sale_id: 's3', currency: 'BTC', price: '100', event_time: 1770000000000 };

      expect(processTelegramMarketEvent(validTon).success).toBe(true);
      expect(processTelegramMarketEvent(validStars).success).toBe(true);
      expect(processTelegramMarketEvent(invalidBtc).success).toBe(false);
      expect(processTelegramMarketEvent(invalidBtc).reason).toContain('invalid currency');
    });

    it('normalizes 10-digit Unix timestamp (seconds) to 13-digit (milliseconds)', () => {
      const payload = {
        collection_id: 'cap',
        sale_id: 's_sec',
        currency: 'TON',
        price: '100',
        event_time: 1770000000, // seconds
        status: 'completed'
      };
      const res = processTelegramMarketEvent(payload);
      expect(res.success).toBe(true);
      expect(allSales[0].eventTime).toBe(1770000000000);
    });

    it('constructs stable saleId from transactionHash + giftId + eventTime when sale_id missing', () => {
      const payload = {
        collection_id: 'cap',
        transaction_hash: '0xtx123',
        gift_id: 'gift_99',
        currency: 'TON',
        price: '100',
        event_time: 1770000000000,
        status: 'completed'
      };
      const res = processTelegramMarketEvent(payload);
      expect(res.success).toBe(true);
      expect(res.saleId).toBe('0xtx123_gift_99_1770000000000');
    });

    it('rejects event if missing both sale_id and transaction_hash', () => {
      const payload = {
        collection_id: 'cap',
        currency: 'TON',
        price: '100',
        event_time: 1770000000000,
        status: 'completed'
      };
      const res = processTelegramMarketEvent(payload);
      expect(res.success).toBe(false);
      expect(res.reason).toContain('unable to construct a stable unique saleId');
    });
  });

  describe('2. Status Handling & Non-Completed Isolation', () => {
    it('handles pending, cancelled, failed, reverted without modifying market history', () => {
      const statuses = ['pending', 'cancelled', 'failed', 'reverted'];
      for (const st of statuses) {
        const payload = {
          collection_id: 'cap',
          sale_id: `s_${st}`,
          currency: 'TON',
          price: '100',
          event_time: 1770000000000,
          status: st
        };
        const res = processTelegramMarketEvent(payload);
        expect(res.success).toBe(true);
        expect(res.processed).toBe(false);
      }

      // Ensure no sales recorded and no candles generated
      expect(allSales.length).toBe(0);
      const history = getMarketCandlesHistory('cap:all:all:TON', '1m');
      expect(history.candles.length).toBe(0);
    });

    it('supports pending -> completed transition for the same saleId', () => {
      const pendingEvt = {
        collection_id: 'cap',
        sale_id: 'sale_trans_1',
        currency: 'TON',
        price: '100',
        event_time: 1770000000000,
        status: 'pending'
      };
      const resPending = processTelegramMarketEvent(pendingEvt);
      expect(resPending.success).toBe(true);
      expect(resPending.processed).toBe(false);
      expect(allSales.length).toBe(0);

      // Now completed event arrives for the same saleId
      const completedEvt = { ...pendingEvt, status: 'completed' };
      const resCompleted = processTelegramMarketEvent(completedEvt);
      expect(resCompleted.success).toBe(true);
      expect(resCompleted.processed).toBe(true);
      expect(allSales.length).toBe(1);

      const history = getMarketCandlesHistory('cap:all:all:TON', '1m');
      expect(history.candles.length).toBe(1);
    });

    it('rejects unknown status', () => {
      const payload = {
        collection_id: 'cap',
        sale_id: 's_unk',
        currency: 'TON',
        price: '100',
        event_time: 1770000000000,
        status: 'invalid_status_xyz'
      };
      const res = processTelegramMarketEvent(payload);
      expect(res.success).toBe(false);
      expect(res.reason).toContain('invalid_status');
    });
  });

  describe('3. Event Deduplication & Out-Of-Order Processing', () => {
    it('deduplicates identical completed events', () => {
      const payload = {
        collection_id: 'cap',
        sale_id: 's_dup',
        currency: 'TON',
        price: '100',
        event_time: 1770000000000,
        status: 'completed'
      };

      const res1 = processTelegramMarketEvent(payload);
      expect(res1.success).toBe(true);
      expect(res1.processed).toBe(true);

      const res2 = processTelegramMarketEvent(payload);
      expect(res2.success).toBe(true);
      expect(res2.processed).toBe(false);
      expect(res2.reason).toBe('duplicate');
      expect(allSales.length).toBe(1);
    });

    it('handles late & out-of-order events accurately', () => {
      const baseTime = 1770000000000;

      // Newer sale at t=120s
      const sNewer = {
        collection_id: 'cap',
        sale_id: 's_newer',
        currency: 'TON',
        price: '200',
        event_time: baseTime + 120000,
        status: 'completed'
      };
      processTelegramMarketEvent(sNewer);

      // Older sale at t=10s (late event)
      const sOlder = {
        collection_id: 'cap',
        sale_id: 's_older',
        currency: 'TON',
        price: '50',
        event_time: baseTime + 10000,
        status: 'completed'
      };
      const resOlder = processTelegramMarketEvent(sOlder);
      expect(resOlder.success).toBe(true);
      expect(resOlder.processed).toBe(true);

      const history = getMarketCandlesHistory('cap:all:all:TON', '1m');
      // Should have candles for both minutes
      expect(history.candles.length).toBe(2);
      const pastCandle = history.candles.find(c => c.startTime === baseTime);
      expect(pastCandle?.close).toBe('50');
    });
  });

  describe('4. Mock Minter & Production Safeguards', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('does not launch simulation unless SIMULATION_MODE or ENABLE_SIMULATION is set', () => {
      delete process.env.SIMULATION_MODE;
      delete process.env.ENABLE_SIMULATION;
      process.env.NODE_ENV = 'development';

      const consoleSpy = vi.spyOn(console, 'log');
      simulateSales(null);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Simulation disabled'));
    });

    it('blocks simulation in production environment by default', () => {
      process.env.SIMULATION_MODE = 'true';
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_SIMULATION_IN_PRODUCTION;

      const warnSpy = vi.spyOn(console, 'warn');
      simulateSales(null);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SAFETY REJECTION'));
    });
  });

  describe('5. Telegram Webhook Replay Fixtures (Sanitized)', () => {
    const fixtures: RawTelegramMarketEvent[] = [
      {
        event_id: 'evt_tg_fixture_001',
        collection_id: 'cap',
        model_id: 'classic',
        backdrop_id: 'starry',
        currency: 'TON',
        price: '120.00',
        quantity: 1,
        event_time: 1770000100000,
        status: 'completed',
        source: 'telegram'
      },
      {
        event_id: 'evt_tg_fixture_002',
        collection_id: 'cap',
        model_id: 'classic',
        backdrop_id: 'starry',
        currency: 'STARS',
        price: '500',
        quantity: 2,
        event_time: 1770000200000,
        status: 'completed',
        source: 'telegram'
      }
    ];

    it('successfully processes replay fixtures', () => {
      for (const fx of fixtures) {
        const res = processTelegramMarketEvent(fx);
        expect(res.success).toBe(true);
        expect(res.processed).toBe(true);
      }
      expect(allSales.length).toBe(2);

      // Verify TON and STARS isolation
      const tonHistory = getMarketCandlesHistory('cap:classic:starry:TON', '1m');
      const starsHistory = getMarketCandlesHistory('cap:classic:starry:STARS', '1m');
      expect(tonHistory.candles.length).toBe(1);
      expect(starsHistory.candles.length).toBe(1);
      expect(tonHistory.candles[0].close).toBe('120');
      expect(starsHistory.candles[0].close).toBe('500');
    });
  });
});
