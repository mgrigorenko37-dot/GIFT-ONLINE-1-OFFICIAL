import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleSubscribe,
  handleUnsubscribe,
  handleDisconnect,
  getSocketSubscriptions,
  clearAllSubscriptions,
  resetSequence,
  parseSubscriptionParams
} from './realtimeManager';
import { acceptCompletedSale, clearMarketState } from './marketState';
import { GiftSale } from './chartEngine';

class MockSocket {
  id: string;
  emittedEvents: { event: string; data: any }[] = [];
  listeners: Record<string, ((data: any) => void)[]> = {};
  rooms: Set<string> = new Set();

  constructor(id: string) {
    this.id = id;
  }

  emit(event: string, data: any) {
    this.emittedEvents.push({ event, data });
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  join(room: string) {
    this.rooms.add(room);
  }

  leave(room: string) {
    this.rooms.delete(room);
  }

  trigger(event: string, data?: any) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        cb(data);
      }
    }
  }

  getMarketEvents(type?: string) {
    const marketEvents = this.emittedEvents
      .filter(e => e.event === 'market_event')
      .map(e => e.data);
    if (type) {
      return marketEvents.filter(m => m.type === type);
    }
    return marketEvents;
  }

  clearEmitted() {
    this.emittedEvents = [];
  }
}

describe('Stage 6: Realtime Socket.io Stream & Subscriptions', () => {
  beforeEach(() => {
    clearMarketState();
    clearAllSubscriptions();
    resetSequence(0);
  });

  describe('Subscription Parsing & Parameter Handling', () => {
    it('parses valid string and object subscription parameters', () => {
      const p1 = parseSubscriptionParams('durov-cap');
      expect(p1.instrumentKey).toBe('durov-cap:all:all:TON');
      expect(p1.timeframes).toBeNull();

      const p2 = parseSubscriptionParams({
        instrumentKey: 'c1:m1:b1:STARS',
        timeframe: '5m'
      });
      expect(p2.instrumentKey).toBe('c1:m1:b1:STARS');
      expect(p2.timeframes).toEqual(['5m']);

      const p3 = parseSubscriptionParams({
        collectionId: 'c2',
        currency: 'TON',
        timeframes: ['1s', '1m', '15m']
      });
      expect(p3.instrumentKey).toBe('c2:all:all:TON');
      expect(p3.timeframes).toEqual(['1s', '1m', '15m']);
    });
  });

  describe('Subscribe & Snapshot Delivery', () => {
    it('subscribes successfully and emits initial snapshot with sequence number', () => {
      const socket = new MockSocket('s1');
      const res = handleSubscribe(socket, {
        instrumentKey: 'durov-cap:all:all:TON',
        timeframe: '1m'
      });

      expect(res.success).toBe(true);
      expect(res.isDuplicate).toBe(false);

      const events = socket.getMarketEvents('snapshot');
      expect(events.length).toBe(1);
      expect(events[0].sequence).toBe(1);
      expect(events[0].instrumentKey).toBe('durov-cap:all:all:TON');
      expect(events[0].timeframes['1m']).toBeDefined();
    });

    it('prevents duplicate subscriptions on the same socket', () => {
      const socket = new MockSocket('s1');
      
      const res1 = handleSubscribe(socket, {
        instrumentKey: 'durov-cap:all:all:TON',
        timeframe: '1m'
      });
      expect(res1.isDuplicate).toBe(false);

      socket.clearEmitted();

      const res2 = handleSubscribe(socket, {
        instrumentKey: 'durov-cap:all:all:TON',
        timeframe: '1m'
      });
      expect(res2.isDuplicate).toBe(true);

      const subs = getSocketSubscriptions('s1');
      expect(subs.length).toBe(1);
    });
  });

  describe('Unsubscribe & Disconnect Resource Cleanup', () => {
    it('unsubscribes and stops delivering market events', () => {
      const socket = new MockSocket('s1');
      handleSubscribe(socket, {
        instrumentKey: 'durov-cap:all:all:TON',
        timeframe: '1m'
      });
      socket.clearEmitted();

      const unres = handleUnsubscribe(socket, {
        instrumentKey: 'durov-cap:all:all:TON',
        timeframe: '1m'
      });
      expect(unres.success).toBe(true);
      expect(unres.removedCount).toBe(1);

      // Trigger a sale
      const sale: GiftSale = {
        id: 'sale-1',
        collectionId: 'durov-cap',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        createdAt: 1710000000000,
        status: 'completed'
      };
      acceptCompletedSale(sale);

      expect(socket.getMarketEvents().length).toBe(0);
    });

    it('cleans up resources completely on disconnect', () => {
      const socket = new MockSocket('s1');
      handleSubscribe(socket, { instrumentKey: 'durov-cap:all:all:TON' });
      
      expect(getSocketSubscriptions('s1').length).toBe(1);

      handleDisconnect(socket);

      expect(getSocketSubscriptions('s1').length).toBe(0);
    });
  });

  describe('Market Isolation & Timeframe Isolation', () => {
    it('strictly isolates streams by collection, currency, model, and timeframe', () => {
      const socketCollectionA = new MockSocket('sA');
      const socketCollectionB = new MockSocket('sB');
      const socketCurrencyStars = new MockSocket('sStars');
      const socketTimeframe1m = new MockSocket('s1m');
      const socketTimeframe5m = new MockSocket('s5m');

      handleSubscribe(socketCollectionA, { collectionId: 'colA', currency: 'TON', timeframe: '1m' });
      handleSubscribe(socketCollectionB, { collectionId: 'colB', currency: 'TON', timeframe: '1m' });
      handleSubscribe(socketCurrencyStars, { collectionId: 'colA', currency: 'STARS', timeframe: '1m' });
      handleSubscribe(socketTimeframe1m, { collectionId: 'colA', currency: 'TON', timeframe: '1m' });
      handleSubscribe(socketTimeframe5m, { collectionId: 'colA', currency: 'TON', timeframe: '5m' });

      socketCollectionA.clearEmitted();
      socketCollectionB.clearEmitted();
      socketCurrencyStars.clearEmitted();
      socketTimeframe1m.clearEmitted();
      socketTimeframe5m.clearEmitted();

      // Emit sale for colA in TON
      const sale: GiftSale = {
        id: 'sale-colA',
        collectionId: 'colA',
        price: '50',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        createdAt: 1710000000000,
        status: 'completed'
      };
      acceptCompletedSale(sale);

      // colB socket receives NOTHING
      expect(socketCollectionB.getMarketEvents().length).toBe(0);

      // STARS socket receives NOTHING
      expect(socketCurrencyStars.getMarketEvents().length).toBe(0);

      // 1m socket receives sale and 1m candle update
      const events1m = socketTimeframe1m.getMarketEvents();
      expect(events1m.some(e => e.type === 'sale')).toBe(true);
      expect(events1m.some(e => e.type === 'candle_update' && e.timeframe === '1m')).toBe(true);
      expect(events1m.some(e => e.timeframe === '5m')).toBe(false); // No 5m event for 1m subscriber!

      // 5m socket receives sale and 5m candle update
      const events5m = socketTimeframe5m.getMarketEvents();
      expect(events5m.some(e => e.type === 'sale')).toBe(true);
      expect(events5m.some(e => e.type === 'candle_update' && e.timeframe === '5m')).toBe(true);
      expect(events5m.some(e => e.timeframe === '1m')).toBe(false); // No 1m event for 5m subscriber!
    });
  });

  describe('Monotonic Sequence Numbers', () => {
    it('ensures each emitted message receives a strictly increasing sequence number', () => {
      const socket = new MockSocket('s1');
      handleSubscribe(socket, { collectionId: 'c1', currency: 'TON', timeframe: '1m' });

      const initialEvents = socket.getMarketEvents();
      const firstSeq = initialEvents[0].sequence;
      expect(typeof firstSeq).toBe('number');

      socket.clearEmitted();

      const sale: GiftSale = {
        id: 'sale-seq-1',
        collectionId: 'c1',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        createdAt: 1710000000000,
        status: 'completed'
      };
      acceptCompletedSale(sale);

      const newEvents = socket.getMarketEvents();
      expect(newEvents.length).toBeGreaterThan(0);

      let prevSeq = firstSeq;
      for (const ev of newEvents) {
        expect(ev.sequence).toBeGreaterThan(prevSeq);
        prevSeq = ev.sequence;
      }
    });
  });

  describe('Candle Rollover (candle_closed) and Late Sales Handling', () => {
    it('emits candle_closed when candle interval expires and new candle starts', () => {
      const socket = new MockSocket('s1');
      handleSubscribe(socket, { collectionId: 'c1', currency: 'TON', timeframe: '1m' });

      // Sale 1 at t=0s
      const sale1: GiftSale = {
        id: 's1',
        collectionId: 'c1',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000, // 00:00:00
        createdAt: 1710000000000,
        status: 'completed'
      };
      acceptCompletedSale(sale1);
      socket.clearEmitted();

      // Sale 2 at t=61s (moves past 1m boundary)
      const sale2: GiftSale = {
        id: 's2',
        collectionId: 'c1',
        price: '105',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000061000, // 00:01:01
        createdAt: 1710000061000,
        status: 'completed'
      };
      acceptCompletedSale(sale2);

      const events = socket.getMarketEvents();
      const closedEvents = events.filter(e => e.type === 'candle_closed' && e.timeframe === '1m');
      const updateEvents = events.filter(e => e.type === 'candle_update' && e.timeframe === '1m');

      expect(closedEvents.length).toBe(1);
      expect(closedEvents[0].candle.confirmed).toBe(true);
      expect(closedEvents[0].candle.close).toBe('100');

      expect(updateEvents.length).toBe(1);
      expect(updateEvents[0].candle.confirmed).toBe(false);
      expect(updateEvents[0].candle.open).toBe('105');
    });

    it('emits candle_update with incremented revision on late sale', () => {
      const socket = new MockSocket('s1');
      handleSubscribe(socket, { collectionId: 'c1', currency: 'TON', timeframe: '1m' });

      // Sale 1 at 00:00:00
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        createdAt: 1710000000000,
        status: 'completed'
      });

      // Sale 2 at 00:01:05 (closes 00:00 candle)
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        price: '105',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000065000,
        createdAt: 1710000065000,
        status: 'completed'
      });

      socket.clearEmitted();

      // Late sale at 00:00:30 (belongs to closed candle)
      acceptCompletedSale({
        id: 's-late',
        collectionId: 'c1',
        price: '120', // High price!
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000030000,
        createdAt: 1710000030000,
        status: 'completed'
      });

      const events = socket.getMarketEvents();
      const lateCandleUpdate = events.find(e => e.type === 'candle_update' && e.candle.startTime === 1710000000000 && e.timeframe === '1m');

      expect(lateCandleUpdate).toBeDefined();
      expect(lateCandleUpdate.candle.high).toBe('120');
      expect(lateCandleUpdate.candle.revision).toBe(2);
    });

    it('does NOT emit Socket.io events for duplicate sales', () => {
      const socket = new MockSocket('s1');
      handleSubscribe(socket, { collectionId: 'c1', currency: 'TON', timeframe: '1m' });

      const sale: GiftSale = {
        id: 'duplicate-sale-id',
        collectionId: 'c1',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        createdAt: 1710000000000,
        status: 'completed'
      };

      acceptCompletedSale(sale);
      socket.clearEmitted();

      // Try ingesting identical sale again
      acceptCompletedSale(sale);

      expect(socket.getMarketEvents().length).toBe(0);
    });
  });
});
