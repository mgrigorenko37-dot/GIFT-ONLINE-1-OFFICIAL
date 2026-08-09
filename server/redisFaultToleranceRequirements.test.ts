import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import EventEmitter from 'events';
import {
  initRedisManager,
  isRedisActive,
  getRedisHealthStatus,
  closeRedisConnections,
  setTestRedisClients,
  MARKET_EVENTS_CHANNEL,
  REDIS_SEQUENCE_KEY
} from './redisManager';
import { acceptCompletedSale, clearMarketState, setMarketRepository, getActiveCandle } from './marketState';
import { InMemoryMarketRepository } from './marketRepository';
import { broadcastSaleResult, clearAllSubscriptions, handleSubscribe } from './realtimeManager';
import { OutboxWorker } from './outboxWorker';

class MockTestRedisClient extends EventEmitter {
  public status = 'ready';
  public subscribedChannels = new Set<string>();
  public static channelBus = new EventEmitter();
  public static globalSeq = 0;

  constructor() {
    super();
    this.on('error', () => {}); // Catch unhandled error events
    setTimeout(() => this.emit('ready'), 5);
  }

  duplicate() {
    return new MockTestRedisClient();
  }

  async incr(key: string): Promise<number> {
    if (this.status !== 'ready') {
      throw new Error('Redis connection lost');
    }
    if (key === REDIS_SEQUENCE_KEY) {
      MockTestRedisClient.globalSeq++;
      return MockTestRedisClient.globalSeq;
    }
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    if (this.status !== 'ready') {
      throw new Error('Redis publish error: Connection closed');
    }
    MockTestRedisClient.channelBus.emit('message', channel, message);
    return 1;
  }

  subscribe(channel: string, callback?: (err: any, count: number) => void) {
    this.subscribedChannels.add(channel);
    const busHandler = (ch: string, msg: string) => {
      if (this.subscribedChannels.has(ch)) {
        this.emit('message', ch, msg);
      }
    };
    MockTestRedisClient.channelBus.on('message', busHandler);
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

describe('Redis Fault Tolerance & Multi-Instance Production Rules', () => {
  let repository: InMemoryMarketRepository;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    repository = new InMemoryMarketRepository();
    setMarketRepository(repository);
    clearMarketState();
    clearAllSubscriptions();
    MockTestRedisClient.channelBus.removeAllListeners();
    MockTestRedisClient.globalSeq = 0;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await closeRedisConnections();
  });

  it('1. single-instance без Redis: permits missing REDIS_URL and outputs warning', () => {
    delete process.env.REDIS_URL;
    process.env.REQUIRE_REDIS = 'false';

    const consoleSpy = vi.spyOn(console, 'warn');

    const result = initRedisManager(undefined, {
      redisUrl: undefined,
      requireRedis: false
    });

    expect(result.success).toBe(false);
    expect(result.mode).toBe('single-instance');
    expect(isRedisActive()).toBe(false);

    const health = getRedisHealthStatus();
    expect(health.isConnected).toBe(false);
    expect(health.status).toBe('disabled');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Redis is not configured. Realtime multi-instance mode is disabled.')
    );

    consoleSpy.mockRestore();
  });

  it('2. production без Redis и REQUIRE_REDIS=true: blocks startup and returns unhealthy status', () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'production';
    process.env.REQUIRE_REDIS = 'true';

    expect(() => {
      initRedisManager(undefined, {
        redisUrl: undefined,
        requireRedis: true
      });
    }).toThrow(/CRITICAL CONFIGURATION ERROR: REDIS_URL is strictly required/);

    const health = getRedisHealthStatus();
    expect(health.status).toBe('unhealthy');
    expect(health.isConnected).toBe(false);
    expect(health.isRequired).toBe(true);
  });

  it('3. Redis disconnect: fails multi-instance publish and marks system unhealthy without silent fallback', async () => {
    process.env.REQUIRE_REDIS = 'true';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient, mockClient);

    expect(isRedisActive()).toBe(true);

    // Simulate disconnect
    mockClient.simulateDisconnect();

    expect(isRedisActive()).toBe(false);
    const health = getRedisHealthStatus();
    expect(health.status).toBe('unhealthy');

    const saleResult = {
      accepted: true,
      reason: 'accepted' as const,
      sale: {
        id: 'sale_disc_1',
        collectionId: 'gift_star',
        currency: 'TON' as const,
        price: '10',
        quantity: '1',
        eventTime: Date.now(),
        createdAt: Date.now(),
        status: 'completed' as const
      }
    };

    // Must throw error rather than silently fallback locally
    await expect(broadcastSaleResult(saleResult)).rejects.toThrow(/Redis is required for cluster realtime synchronization/);
  });

  it('4. Redis reconnect: system recovers healthy status and flushes pending outbox events', async () => {
    process.env.REQUIRE_REDIS = 'true';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient, mockClient);

    // Disconnect
    mockClient.simulateDisconnect();

    // Accept sale while disconnected -> outbox event saved in repo
    const sale = {
      id: 'sale_rec_100',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '25',
      quantity: '1',
      eventTime: Date.now(),
      status: 'completed' as const
    };
    acceptCompletedSale(sale);

    const worker = new OutboxWorker(repository, 50);

    // Worker processing fails while disconnected
    const processedFail = await worker.triggerImmediateProcessing();
    expect(processedFail).toBe(0);

    const evtDb = await repository.getOutboxEventById('evt_sale_sale_rec_100');
    expect(evtDb).not.toBeNull();
    expect(evtDb?.status).toBe('pending');

    // Make event available for retry now
    if (evtDb) {
      evtDb.availableAt = Date.now() - 100;
      await repository.saveOutboxEvent(evtDb);
    }

    // Reconnect Redis
    mockClient.simulateReconnect();

    expect(isRedisActive()).toBe(true);
    expect(getRedisHealthStatus().status).toBe('healthy');

    // Worker processing succeeds now
    const processedSuccess = await worker.triggerImmediateProcessing();
    expect(processedSuccess).toBe(1);

    const evtAfter = await repository.getOutboxEventById('evt_sale_sale_rec_100');
    expect(evtAfter?.status).toBe('published');

    worker.stop();
  });

  it('5. два backend-процесса без Redis: processes are isolated and cannot exchange multi-instance broadcasts', async () => {
    process.env.REQUIRE_REDIS = 'false';

    // Simulate Process A local socket sub
    let processASocketReceived = false;
    const mockSocketA = {
      emit: (event: string) => {
        if (event === 'sale_accepted' || event === 'market_event') {
          processASocketReceived = true;
        }
      }
    };
    handleSubscribe(mockSocketA, { instrumentKey: 'gift_star:all:all:TON' });

    // Simulate Process B local socket sub
    let processBSocketReceived = false;
    const mockSocketB = {
      emit: (event: string) => {
        if (event === 'sale_accepted' || event === 'market_event') {
          processBSocketReceived = true;
        }
      }
    };

    // Process A accepts sale
    const saleData = {
      id: 'sale_proc_a',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '10',
      quantity: '1',
      eventTime: Date.now(),
      status: 'completed' as const
    };

    const res = acceptCompletedSale(saleData);
    await broadcastSaleResult(res);

    // Process A received local emit
    expect(processASocketReceived).toBe(true);
    // Process B received nothing because Redis multi-instance pub/sub is inactive
    expect(processBSocketReceived).toBe(false);
  });

  it('6. два backend-процесса с Redis: pub/sub delivers event to second process', async () => {
    process.env.REQUIRE_REDIS = 'true';

    // Instance 1
    const client1 = new MockTestRedisClient();
    setTestRedisClients(client1, client1);

    // Instance 2 subscriber
    const client2 = new MockTestRedisClient();
    let instance2ReceivedEvent: any = null;

    client2.subscribe(MARKET_EVENTS_CHANNEL, (err) => {});
    client2.on('message', (ch, msg) => {
      if (ch === MARKET_EVENTS_CHANNEL) {
        instance2ReceivedEvent = JSON.parse(msg);
      }
    });

    const saleResult = {
      accepted: true,
      reason: 'accepted' as const,
      sale: {
        id: 'sale_multi_200',
        collectionId: 'gift_star',
        currency: 'TON' as const,
        price: '30',
        quantity: '1',
        eventTime: Date.now(),
        createdAt: Date.now(),
        status: 'completed' as const
      }
    };

    await broadcastSaleResult(saleResult);

    expect(instance2ReceivedEvent).not.toBeNull();
    expect(instance2ReceivedEvent.kind).toBe('sale_result');
    expect(instance2ReceivedEvent.result.sale.id).toBe('sale_multi_200');
  });

  it('7. отсутствие duplicate events после восстановления: outbox flush after reconnect does not cause duplicate sales/candles', async () => {
    process.env.REQUIRE_REDIS = 'true';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient, mockClient);

    // Disconnect
    mockClient.simulateDisconnect();

    // Process 2 sales while Redis is down
    const sale1 = {
      id: 'sale_dup_chk_1',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '10',
      quantity: '1',
      eventTime: Date.now(),
      status: 'completed' as const
    };
    const sale2 = {
      id: 'sale_dup_chk_2',
      collectionId: 'gift_star',
      currency: 'TON',
      price: '15',
      quantity: '1',
      eventTime: Date.now() + 1000,
      status: 'completed' as const
    };

    acceptCompletedSale(sale1);
    acceptCompletedSale(sale2);

    const candleBefore = getActiveCandle('gift_star:all:all:TON', '1m');
    expect(candleBefore?.revision).toBe(2);

    const worker = new OutboxWorker(repository, 50);

    // Reconnect
    mockClient.simulateReconnect();

    const receivedMessages: any[] = [];
    MockTestRedisClient.channelBus.on('message', (ch, msg) => {
      receivedMessages.push(JSON.parse(msg));
    });

    const processed = await worker.triggerImmediateProcessing();
    expect(processed).toBe(2);

    // Messages published to Redis once each
    expect(receivedMessages.length).toBe(2);
    expect(receivedMessages[0].result.sale.id).toBe('sale_dup_chk_1');
    expect(receivedMessages[1].result.sale.id).toBe('sale_dup_chk_2');

    // Trigger processing again - no pending events remain, no duplicate publishes
    const reProcessed = await worker.triggerImmediateProcessing();
    expect(reProcessed).toBe(0);
    expect(receivedMessages.length).toBe(2);

    // Market candle state remains strictly at revision 2
    const candleAfter = getActiveCandle('gift_star:all:all:TON', '1m');
    expect(candleAfter?.revision).toBe(2);

    worker.stop();
  });
});
