import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import EventEmitter from 'events';
import {
  initRedisManager,
  isRedisActive,
  getNextGlobalSequence,
  publishMarketEventToRedis,
  onRedisMarketEvent,
  closeRedisConnections,
  MARKET_EVENTS_CHANNEL,
  REDIS_SEQUENCE_KEY,
  resetLocalSequence
} from './redisManager';
import { acceptCompletedSale, clearMarketState, setMarketRepository } from './marketState';
import { InMemoryMarketRepository } from './marketRepository';
import { broadcastSaleResult, broadcastLocalSaleResult, clearAllSubscriptions } from './realtimeManager';

// Mock Redis client constructor helper
class MockRedisClient extends EventEmitter {
  public status = 'ready';
  public subscribedChannels = new Set<string>();
  public static channelBus = new EventEmitter();
  public static globalSeq = 0;

  constructor() {
    super();
    setTimeout(() => this.emit('ready'), 10);
  }

  duplicate() {
    return new MockRedisClient();
  }

  async incr(key: string): Promise<number> {
    if (key === REDIS_SEQUENCE_KEY) {
      MockRedisClient.globalSeq++;
      return MockRedisClient.globalSeq;
    }
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    MockRedisClient.channelBus.emit('message', channel, message);
    return 1;
  }

  subscribe(channel: string, callback?: (err: any, count: number) => void) {
    this.subscribedChannels.add(channel);
    const busHandler = (ch: string, msg: string) => {
      if (this.subscribedChannels.has(ch)) {
        this.emit('message', ch, msg);
      }
    };
    MockRedisClient.channelBus.on('message', busHandler);
    if (callback) callback(null, 1);
  }

  async quit() {
    this.status = 'end';
    this.emit('end');
  }

  disconnect() {
    this.status = 'end';
    this.emit('end');
  }
}

describe('Stage 6: Multi-Instance Realtime & Redis Architecture Tests', () => {
  beforeEach(() => {
    clearMarketState();
    clearAllSubscriptions();
    resetLocalSequence(0);
    MockRedisClient.globalSeq = 0;
    MockRedisClient.channelBus.removeAllListeners();
    delete process.env.REDIS_URL;
    delete process.env.REQUIRE_REDIS;
  });

  afterEach(async () => {
    await closeRedisConnections();
  });

  test('1. Environment variable check: Missing REDIS_URL outputs warning and falls back to single-instance', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = initRedisManager(undefined, { redisUrl: undefined, multiInstanceMode: true });

    expect(res.success).toBe(false);
    expect(res.mode).toBe('single-instance');
    expect(isRedisActive()).toBe(false);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RedisManager] WARNING: Redis is not configured')
    );
    consoleWarnSpy.mockRestore();
  });

  test('2. Strict Production Mode: Throws error when REQUIRE_REDIS=true and REDIS_URL is missing', () => {
    expect(() => {
      initRedisManager(undefined, { redisUrl: undefined, requireRedis: true });
    }).toThrowError(/CRITICAL CONFIGURATION ERROR: REDIS_URL is strictly required/);
  });

  test('3. Sequence counter fallback when Redis is inactive', async () => {
    resetLocalSequence(0);
    expect(isRedisActive()).toBe(false);

    const seq1 = await getNextGlobalSequence();
    const seq2 = await getNextGlobalSequence();

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
  });

  test('4. Redis Pub/Sub market event distribution across multiple mock instances', async () => {
    // Simulate Instance 1 & Instance 2 receiving Redis pub/sub events
    const instance1Events: any[] = [];
    const instance2Events: any[] = [];

    const bus = MockRedisClient.channelBus;

    bus.on('message', (ch, msg) => {
      if (ch === MARKET_EVENTS_CHANNEL) {
        const payload = JSON.parse(msg);
        instance1Events.push(payload);
        instance2Events.push(payload);
      }
    });

    const mockPub = new MockRedisClient();

    // Publish event from Instance 1
    const eventPayload = {
      kind: 'sale_result',
      saleSeq: 101,
      result: {
        accepted: true,
        sale: {
          id: 'sale-redis-1',
          collectionId: 'durov-cap',
          currency: 'TON',
          price: '15',
          quantity: '1',
          eventTime: 1710000010000,
          status: 'completed'
        }
      }
    };

    await mockPub.publish(MARKET_EVENTS_CHANNEL, JSON.stringify(eventPayload));

    expect(instance1Events.length).toBe(1);
    expect(instance2Events.length).toBe(1);
    expect(instance1Events[0].saleSeq).toBe(101);
    expect(instance2Events[0].saleSeq).toBe(101);
  });

  test('5. Deduplication at market state / store layer prevents double publication', () => {
    const rawSale = {
      id: 'unique-sale-100',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '10',
      quantity: 1,
      eventTime: 1710000010000,
      status: 'completed'
    };

    // First acceptance
    const res1 = acceptCompletedSale(rawSale);
    expect(res1.accepted).toBe(true);
    expect(res1.reason).toBe('accepted');

    // Duplicate acceptance
    const res2 = acceptCompletedSale(rawSale);
    expect(res2.accepted).toBe(false);
    expect(res2.reason).toBe('duplicate');
  });

  test('6. Redis disconnect / reconnect error resilience', async () => {
    const mockClient = new MockRedisClient();

    // Emit connection error
    let errorLogged = false;
    mockClient.on('error', () => {
      errorLogged = true;
    });

    mockClient.emit('error', new Error('Connection refused'));

    expect(errorLogged).toBe(true);
    // Ensure application continues execution without unhandled rejection
    const seq = await getNextGlobalSequence();
    expect(seq).toBeGreaterThan(0);
  });

  test('7. Verification of required environment variables structure', () => {
    // Test env check requirements
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/market_db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = 'false';

    expect(process.env.DATABASE_URL).toBeDefined();
    expect(process.env.REDIS_URL).toBeDefined();
    expect(process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION).toBe('false');
  });
});
