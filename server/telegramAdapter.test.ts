import { describe, it, expect, beforeEach } from 'vitest';
import { processTelegramMarketEvent } from './telegramAdapter';
import { clearMarketState, allSales } from './marketState';

describe('Telegram Market Adapter Tests', () => {
  beforeEach(() => {
    clearMarketState();
  });

  it('accepts and normalizes a valid completed event', () => {
    const raw = {
      event_id: 'tg_evt_001',
      collection_id: 'durov-cap',
      gift_id: 'gift_99',
      currency: 'TON',
      price: '150.50',
      quantity: '1',
      event_time: 1770000000000,
      status: 'completed',
      transaction_hash: '0xabc123',
    };

    const res = processTelegramMarketEvent(raw);
    expect(res.success).toBe(true);
    expect(res.processed).toBe(true);
    expect(res.saleId).toBe('tg_evt_001');
    expect(allSales.length).toBe(1);
    expect(allSales[0].price).toBe('150.5');
  });

  it('converts 10-digit timestamp in seconds to milliseconds', () => {
    const raw = {
      sale_id: 'tg_sec_001',
      collection_id: 'durov-cap',
      currency: 'TON',
      price: '100',
      quantity: '1',
      event_time: 1770000000, // 10 digits
      status: 'completed',
    };

    const res = processTelegramMarketEvent(raw);
    expect(res.success).toBe(true);
    expect(res.processed).toBe(true);
    expect(allSales[0].eventTime).toBe(1770000000000);
  });

  it('handles non-completed statuses gracefully without modifying market state', () => {
    const pendingEvent = {
      sale_id: 'tg_pending_001',
      collection_id: 'durov-cap',
      currency: 'TON',
      price: '100',
      event_time: 1770000000000,
      status: 'pending',
    };

    const res = processTelegramMarketEvent(pendingEvent);
    expect(res.success).toBe(true);
    expect(res.processed).toBe(false);
    expect(res.reason).toBe('ignored_pending_status');
    expect(allSales.length).toBe(0);
  });

  it('safely rejects malformed payloads', () => {
    const invalidPayloads = [
      null,
      undefined,
      'not_an_object',
      {}, // missing collectionId
      { collection_id: 'durov-cap', price: '-50' }, // invalid price
      { collection_id: 'durov-cap', price: '100', currency: 'USD' }, // invalid currency
    ];

    for (const p of invalidPayloads) {
      const res = processTelegramMarketEvent(p);
      expect(res.success).toBe(false);
      expect(res.processed).toBe(false);
    }
  });

  it('deduplicates repeat completed sales', () => {
    const raw = {
      sale_id: 'tg_dup_001',
      collection_id: 'durov-cap',
      currency: 'TON',
      price: '100',
      event_time: 1770000000000,
      status: 'completed',
    };

    const res1 = processTelegramMarketEvent(raw);
    expect(res1.success).toBe(true);
    expect(res1.processed).toBe(true);

    const res2 = processTelegramMarketEvent(raw);
    expect(res2.success).toBe(true);
    expect(res2.processed).toBe(false);
    expect(res2.reason).toBe('duplicate');
    expect(allSales.length).toBe(1);
  });
});
