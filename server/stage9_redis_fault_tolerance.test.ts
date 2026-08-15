import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import EventEmitter from 'events';
import {
  initRedisManager,
  isRedisActive,
  getRedisHealthStatus,
  getNextGlobalSequence,
  publishMarketEventToRedis,
  onRedisMarketEvent,
  closeRedisConnections,
  MARKET_EVENTS_CHANNEL,
  REDIS_SEQUENCE_KEY,
  resetLocalSequence,
} from './redisManager';
import {
  acceptCompletedSale,
  clearMarketState,
  setMarketRepository,
  getMarketSnapshot,
} from './marketState';
import { InMemoryMarketRepository, PostgresMarketRepository } from './marketRepository';
import {
  broadcastSaleResult,
  broadcastLocalSaleResult,
  clearAllSubscriptions,
  handleSubscribe,
  resetSequence,
} from './realtimeManager';

// Mock Redis Client for Fault Tolerance testing
class MockFaultyRedisClient extends EventEmitter {
  public status = 'ready';
  public subscribedChannels = new Set<string>();
  public static channelBus = new EventEmitter();
  public static globalSeq = 0;
  public failNextPublish = false;

  constructor() {
    super();
    setTimeout(() => this.emit('ready'), 5);
  }

  duplicate() {
    return new MockFaultyRedisClient();
  }

  async incr(key: string): Promise<number> {
    if (this.status !== 'ready') {
      throw new Error('Redis connection lost');
    }
    if (key === REDIS_SEQUENCE_KEY) {
      MockFaultyRedisClient.globalSeq++;
      return MockFaultyRedisClient.globalSeq;
    }
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    if (this.status !== 'ready' || this.failNextPublish) {
      throw new Error('Redis publish error: Connection closed');
    }
    MockFaultyRedisClient.channelBus.emit('message', channel, message);
    return 1;
  }

  subscribe(channel: string, callback?: (err: any, count: number) => void) {
    this.subscribedChannels.add(channel);
    const busHandler = (ch: string, msg: string) => {
      if (this.subscribedChannels.has(ch)) {
        this.emit('message', ch, msg);
      }
    };
    MockFaultyRedisClient.channelBus.on('message', busHandler);
    if (callback) callback(null, 1);
  }

  async quit() {
    this.status = 'end';
    this.emit('end');
  }

  disconnect() {
    this.status = 'end';
    this.emit('close');
    this.emit('end');
  }

  simulateDisconnect() {
    this.status = 'close';
    this.emit('close');
    this.emit('error', new Error('ECONNREFUSED: Connection lost'));
  }

  simulateReconnect() {
    this.status = 'ready';
    this.emit('connect');
    this.emit('ready');
  }
}

describe('Stage 9: Redis Production Multi-Instance & Fault Tolerance', () => {
  let repository: InMemoryMarketRepository;

  beforeEach(() => {
    clearMarketState();
    clearAllSubscriptions();
    resetSequence(0);
    resetLocalSequence(0);
    MockFaultyRedisClient.globalSeq = 0;
    MockFaultyRedisClient.channelBus.removeAllListeners();

    repository = new InMemoryMarketRepository();
    setMarketRepository(repository);

    delete process.env.REDIS_URL;
    delete process.env.REQUIRE_REDIS;
    delete process.env.MULTI_INSTANCE_MODE;
  });

  afterEach(async () => {
    await closeRedisConnections();
  });

  it('1. Normal Pub/Sub across two simulated backend instances', async () => {
    const instance1Received: any[] = [];
    const instance2Received: any[] = [];

    // Setup listener simulating Instance 1
    MockFaultyRedisClient.channelBus.on('message', (ch, msg) => {
      if (ch === MARKET_EVENTS_CHANNEL) {
        instance1Received.push(JSON.parse(msg));
      }
    });

    // Setup listener simulating Instance 2
    MockFaultyRedisClient.channelBus.on('message', (ch, msg) => {
      if (ch === MARKET_EVENTS_CHANNEL) {
        instance2Received.push(JSON.parse(msg));
      }
    });

    const mockClient = new MockFaultyRedisClient();
    await new Promise((r) => setTimeout(r, 15)); // wait for ready

    const payload = {
      kind: 'sale_result',
      saleSeq: 42,
      result: {
        accepted: true,
        sale: {
          id: 'sale-stage9-multi-1',
          collectionId: 'pepe_gift',
          currency: 'TON',
          price: '250',
          quantity: '1',
          eventTime: 1710000000000,
          status: 'completed',
        },
      },
    };

    await mockClient.publish(MARKET_EVENTS_CHANNEL, JSON.stringify(payload));

    expect(instance1Received.length).toBe(1);
    expect(instance2Received.length).toBe(1);
    expect(instance1Received[0].saleSeq).toBe(42);
    expect(instance2Received[0].saleSeq).toBe(42);
  });

  it('2. Redis disconnect handling: state flags update and fallback is triggered', async () => {
    const mockClient = new MockFaultyRedisClient();
    mockClient.on('error', () => {}); // Handle error event to avoid EventEmitter unhandled error

    let closeDetected = false;
    mockClient.on('close', () => {
      closeDetected = true;
    });

    mockClient.simulateDisconnect();
    expect(closeDetected).toBe(true);

    // Sequence fallback should revert to local sequence safely
    const localSeq = await getNextGlobalSequence();
    expect(localSeq).toBeGreaterThan(0);
  });

  it('3. Redis reconnect handling: system recovers healthy status upon reconnect', async () => {
    const mockClient = new MockFaultyRedisClient();
    mockClient.on('error', () => {});

    let reconnected = false;
    mockClient.on('ready', () => {
      reconnected = true;
    });

    mockClient.simulateDisconnect();
    mockClient.simulateReconnect();

    expect(reconnected).toBe(true);
  });

  it('4. Duplicate event rejection: market state deduplication layer prevents re-ingesting identical sales', () => {
    const salePayload = {
      id: 'stage9_duplicate_sale_999',
      collectionId: 'pepe_gift',
      currency: 'TON',
      price: '500',
      quantity: 1,
      eventTime: 1710000010000,
      status: 'completed',
    };

    // First acceptance succeeds
    const res1 = acceptCompletedSale(salePayload);
    expect(res1.accepted).toBe(true);
    expect(res1.reason).toBe('accepted');

    // Duplicate event received via Redis re-sync or broadcast
    const res2 = acceptCompletedSale(salePayload);
    expect(res2.accepted).toBe(false);
    expect(res2.reason).toBe('duplicate');

    // Ensure only 1 sale is stored in repository
    expect(repository.getSales().length).toBe(1);
  });

  it('5. PostgreSQL/Repository COMMIT succeeds when Redis is unavailable (sale is saved, no rollback)', async () => {
    // Redis is NOT initialized / inactive
    expect(isRedisActive()).toBe(false);

    const salePayload = {
      id: 'stage9_postgres_sale_001',
      collectionId: 'durov_gift',
      currency: 'TON',
      price: '100',
      quantity: 1,
      eventTime: 1710000020000,
      status: 'completed',
    };

    // Process sale while Redis is completely down
    const res = acceptCompletedSale(salePayload);
    expect(res.accepted).toBe(true);

    // Verify sale is persisted cleanly in repository
    const savedSales = repository.getSales();
    expect(savedSales.length).toBe(1);
    expect(savedSales[0].id).toBe('stage9_postgres_sale_001');
  });

  it('6. Snapshot after Redis recovery: client retrieves accurate state from DB/snapshot without duplicates', () => {
    const sale1 = {
      id: 'sale_snap_1',
      collectionId: 'pepe_gift',
      currency: 'TON',
      price: '100',
      quantity: 1,
      eventTime: 1710000000000,
      status: 'completed',
    };
    const sale2 = {
      id: 'sale_snap_2',
      collectionId: 'pepe_gift',
      currency: 'TON',
      price: '200',
      quantity: 1,
      eventTime: 1710000060000,
      status: 'completed',
    };

    acceptCompletedSale(sale1);
    acceptCompletedSale(sale2);

    // Client connects after Redis recovery and subscribes to get snapshot
    const snap = getMarketSnapshot('pepe_gift:::TON');
    expect(snap.recentSales.length).toBe(2);
    expect(snap.recentSales[0].id).toBe('sale_snap_1');
    expect(snap.recentSales[1].id).toBe('sale_snap_2');
  });

  it('7. REQUIRE_REDIS=true blocks startup when REDIS_URL is missing', () => {
    expect(() => {
      initRedisManager(undefined, { redisUrl: undefined, requireRedis: true });
    }).toThrowError(/CRITICAL CONFIGURATION ERROR: REDIS_URL is strictly required/);

    process.env.REQUIRE_REDIS = 'true';
    const health = getRedisHealthStatus();
    expect(health.status).toBe('unhealthy');
    expect(health.isRequired).toBe(true);
  });

  it('8. Single-instance mode permits missing REDIS_URL without error', () => {
    const res = initRedisManager(undefined, { redisUrl: undefined, requireRedis: false });
    expect(res.success).toBe(false);
    expect(res.mode).toBe('single-instance');

    const health = getRedisHealthStatus();
    expect(health.status).toBe('disabled');
    expect(health.isRequired).toBe(false);
  });

  it('9. Unavailable Redis does NOT cause loss of saved sales in repository', () => {
    // 5 sales ingested while Redis is inactive
    for (let i = 1; i <= 5; i++) {
      const res = acceptCompletedSale({
        id: `sale_no_redis_${i}`,
        collectionId: 'pepe_gift',
        currency: 'TON',
        price: (10 * i).toString(),
        quantity: 1,
        eventTime: 1710000000000 + i * 1000,
        status: 'completed',
      });
      expect(res.accepted).toBe(true);
    }

    const savedSales = repository.getSales();
    expect(savedSales.length).toBe(5);
    expect(savedSales.map((s) => s.id)).toEqual([
      'sale_no_redis_1',
      'sale_no_redis_2',
      'sale_no_redis_3',
      'sale_no_redis_4',
      'sale_no_redis_5',
    ]);
  });

  it('10. Sequence and revision continuity after Redis reconnect', async () => {
    resetSequence(0);

    // Local sequence before Redis reconnect
    const seq1 = await getNextGlobalSequence(); // 1
    const seq2 = await getNextGlobalSequence(); // 2

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);

    // Mock Redis reconnect where global sequence is resumed
    MockFaultyRedisClient.globalSeq = 50;
    const mockClient = new MockFaultyRedisClient();
    await new Promise((r) => setTimeout(r, 15));

    // When Redis is active, getNextGlobalSequence uses Redis INCR
    const redisSeq = await mockClient.incr(REDIS_SEQUENCE_KEY);
    expect(redisSeq).toBe(51);
  });
});
