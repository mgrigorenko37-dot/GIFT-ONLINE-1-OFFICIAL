import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearMarketState,
  acceptCompletedSale,
  getMarketCandlesHistory,
  serializeMarketState,
  restoreMarketState,
  setMarketRepository,
  getActiveCandle
} from './marketState';
import { InMemoryMarketRepository, OutboxEvent } from './marketRepository';
import { CandleStore } from '../src/lib/realtimeStream';
import { updateCandle, createCandleFromSale, GiftSale, GiftCandle } from './chartEngine';

describe('Outbox Events & Candle Revision Ordering Invariants', () => {
  let repo: InMemoryMarketRepository;

  beforeEach(() => {
    repo = new InMemoryMarketRepository();
    setMarketRepository(repo);
    clearMarketState();
  });

  it('1. Revision non-decreasing: CandleStore rejects stale events with lower revision', () => {
    const store = new CandleStore('gift_star:TON', '1m');

    const candleRev1: GiftCandle = {
      instrumentKey: 'gift_star:TON',
      timeframe: '1m',
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '10',
      low: '10',
      close: '10',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      itemCount: '1',
      sumQuote: '10',
      sumQuantity: '1',
      firstSaleId: 'sale_1',
      lastSaleId: 'sale_1',
      confirmed: false,
      revision: 1,
      updatedAt: 1710000005000
    };

    const candleRev2: GiftCandle = {
      ...candleRev1,
      close: '12',
      high: '12',
      volume: '2',
      quoteVolume: '22',
      tradeCount: 2,
      lastSaleId: 'sale_2',
      revision: 2,
      updatedAt: 1710000010000
    };

    // Apply Revision 2 first (simulating out-of-order execution)
    const res2 = store.applyCandle(candleRev2);
    expect(res2.updated).toBe(true);
    expect(store.getSortedCandles()[0].revision).toBe(2);
    expect(store.getSortedCandles()[0].close).toBe('12');

    // Attempt to apply stale Revision 1
    const res1 = store.applyCandle(candleRev1);
    expect(res1.updated).toBe(false);
    expect(store.getSortedCandles()[0].revision).toBe(2);
    expect(store.getSortedCandles()[0].close).toBe('12');
  });

  it('2. Database-backed ordering: Market repository rejects stale candle writes with lower revision', async () => {
    const candleRev1: GiftCandle = {
      instrumentKey: 'gift_star:TON',
      timeframe: '1m',
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10',
      high: '10',
      low: '10',
      close: '10',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      itemCount: '1',
      sumQuote: '10',
      sumQuantity: '1',
      firstSaleId: 'sale_1',
      lastSaleId: 'sale_1',
      confirmed: false,
      revision: 1,
      updatedAt: 1710000005000
    };

    const candleRev2: GiftCandle = {
      ...candleRev1,
      close: '15',
      revision: 2,
      updatedAt: 1710000010000
    };

    // Save Revision 2 first
    await repo.saveCandles('gift_star:TON', '1m', [candleRev2]);
    const stored1 = repo.getCandles('gift_star:TON', '1m')[0];
    expect(stored1.revision).toBe(2);
    expect(stored1.close).toBe('15');

    // Attempt to write stale Revision 1
    await repo.saveSaleAndCandlesAtomic(
      {
        id: 'sale_stale_1',
        collectionId: 'gift_star',
        currency: 'TON',
        price: '10',
        quantity: '1',
        eventTime: 1710000005000,
        createdAt: 1710000005000,
        status: 'completed'
      },
      [candleRev1]
    );

    const stored2 = repo.getCandles('gift_star:TON', '1m')[0];
    expect(stored2.revision).toBe(2);
    expect(stored2.close).toBe('15');
  });

  it('3. Duplicate event handling: Duplicate sales do not re-update candle or increase revision', () => {
    const sale: GiftSale = {
      id: 'sale_dup_test',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '20',
      quantity: '1',
      eventTime: 1710000005000,
      createdAt: 1710000005000,
      status: 'completed'
    };

    const res1 = acceptCompletedSale(sale);
    expect(res1.accepted).toBe(true);

    const activeCandleBefore = getActiveCandle('gift_star:all:all:TON', '1m');
    expect(activeCandleBefore?.revision).toBe(1);

    // Duplicate submission of exact same sale
    const res2 = acceptCompletedSale(sale);
    expect(res2.accepted).toBe(false);
    expect(res2.reason).toBe('duplicate');

    const activeCandleAfter = getActiveCandle('gift_star:all:all:TON', '1m');
    expect(activeCandleAfter?.revision).toBe(1); // Revision unchanged
  });

  it('4. Stable event_id: Outbox events generated for a sale have deterministic stable eventId', () => {
    const sale: GiftSale = {
      id: 'sale_unique_456',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '50',
      quantity: '1',
      eventTime: 1710000005000,
      createdAt: 1710000005000,
      status: 'completed'
    };

    const res = acceptCompletedSale(sale);
    expect(res.accepted).toBe(true);

    const outboxEvents = repo['outboxEvents'] as OutboxEvent[];
    expect(outboxEvents.length).toBe(1);
    expect(outboxEvents[0].eventId).toBe('evt_sale_sale_unique_456');
    expect(outboxEvents[0].aggregateId).toBe('sale_unique_456');
  });

  it('5. Restart recovery: Sequence/revision state restores accurately from snapshot', () => {
    const sale1 = {
      id: 'sale_rst_1',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '10',
      quantity: '1',
      eventTime: 1710000005000,
      status: 'completed'
    };
    const sale2 = {
      id: 'sale_rst_2',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '12',
      quantity: '1',
      eventTime: 1710000010000,
      status: 'completed'
    };

    acceptCompletedSale(sale1);
    acceptCompletedSale(sale2);

    const activeBefore = getActiveCandle('gift_star:all:all:TON', '1m');
    expect(activeBefore?.revision).toBe(2);
    expect(activeBefore?.close).toBe('12');

    // Take snapshot and restart/restore state
    const snapshot = serializeMarketState();
    clearMarketState();

    expect(getActiveCandle('gift_star:all:all:TON', '1m')).toBeNull();

    restoreMarketState(snapshot);

    const activeAfter = getActiveCandle('gift_star:all:all:TON', '1m');
    expect(activeAfter?.revision).toBe(2);
    expect(activeAfter?.close).toBe('12');
  });
});
