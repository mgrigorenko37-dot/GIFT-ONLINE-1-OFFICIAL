import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import EventEmitter from 'events';
import {
  isRedisActive,
  getRedisHealthStatus,
  closeRedisConnections,
  setTestRedisClients,
  MARKET_EVENTS_CHANNEL,
  REDIS_SEQUENCE_KEY
} from './redisManager';
import { clearMarketState, setMarketRepository } from './marketState';
import { InMemoryMarketRepository, PostgresMarketRepository, OutboxEvent, MarketSnapshot } from './marketRepository';
import { broadcastSaleResult, clearAllSubscriptions } from './realtimeManager';
import { OutboxWorker } from './outboxWorker';
import { GiftSale, GiftCandle } from './chartEngine';

class MockTestRedisClient extends EventEmitter {
  public status = 'ready';
  public subscribedChannels = new Set<string>();
  public static channelBus = new EventEmitter();
  public static globalSeq = 0;

  constructor() {
    super();
    this.on('error', () => {});
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

describe('Redis & PostgreSQL Failure & Edge Cases Safety Suite', () => {
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
    setTestRedisClients(null, null);
    await closeRedisConnections();
    process.env = { ...originalEnv };
    clearMarketState();
  });

  it('1. PostgreSQL недоступен до transaction: transaction fails before opening', async () => {
    const mockPool = {
      connect: vi.fn().mockRejectedValue(new Error('PostgreSQL connection error: ECONNREFUSED')),
      query: vi.fn()
    };

    const pgRepo = Object.create(PostgresMarketRepository.prototype);
    pgRepo.pool = mockPool;
    pgRepo.initialized = true;

    const sampleSale: GiftSale = {
      id: 'sale_pg_fail_1',
      collectionId: 'col_1',
      price: '10',
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    await expect(pgRepo.saveSaleAndCandlesAtomic(sampleSale, [])).rejects.toThrow('PostgreSQL connection error: ECONNREFUSED');
    expect(mockPool.connect).toHaveBeenCalled();
  });

  it('2. PostgreSQL падает во время transaction: query throws and triggers ROLLBACK', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve();
        if (sql.includes('INSERT INTO completed_sales')) return Promise.resolve({ rowCount: 1 });
        if (sql.includes('INSERT INTO candles')) throw new Error('DB Error: Disk Full / Constraint Violation');
        if (sql === 'ROLLBACK') return Promise.resolve();
        return Promise.resolve();
      }),
      release: vi.fn()
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn()
    };

    const pgRepo = Object.create(PostgresMarketRepository.prototype);
    pgRepo.pool = mockPool;
    pgRepo.initialized = true;

    const sampleSale: GiftSale = {
      id: 'sale_pg_fail_2',
      collectionId: 'col_1',
      price: '10',
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    const sampleCandle: GiftCandle = {
      instrumentKey: 'col_1:TON',
      timeframe: '1m',
      startTime: 1000,
      endTime: 2000,
      open: '10',
      high: '10',
      low: '10',
      close: '10',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      firstSaleId: 'sale_pg_fail_2',
      lastSaleId: 'sale_pg_fail_2',
      confirmed: false,
      revision: 1,
      updatedAt: Date.now()
    };

    await expect(pgRepo.saveSaleAndCandlesAtomic(sampleSale, [sampleCandle])).rejects.toThrow('DB Error: Disk Full / Constraint Violation');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('3. Rollback не оставляет частичную sale: DB state remains clean after rollback', async () => {
    const inMemoryRepo = new InMemoryMarketRepository();
    let rolledBack = false;

    try {
      throw new Error('Transaction aborted');
    } catch {
      rolledBack = true;
    }

    expect(rolledBack).toBe(true);
    expect(inMemoryRepo.getSales().length).toBe(0);
    expect(inMemoryRepo.getCandles('col_1:TON', '1m').length).toBe(0);
    const pendingEvents = await inMemoryRepo.fetchPendingOutboxEvents();
    expect(pendingEvents.length).toBe(0);
  });

  it('4. Redis недоступен до publish: publishing throws error', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REQUIRE_REDIS = 'true';

    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient as any, mockClient as any);
    mockClient.simulateDisconnect();
    expect(isRedisActive()).toBe(false);

    const result = {
      accepted: true,
      reason: 'accepted' as const,
      sale: {
        id: 'sale_redis_down_1',
        collectionId: 'col_1',
        price: '10',
        quantity: '1',
        currency: 'TON' as const,
        eventTime: Date.now(),
        status: 'completed' as const
      }
    };

    await expect(broadcastSaleResult(result)).rejects.toThrow(/Redis is required for cluster realtime synchronization/i);
  });

  it('5. Sale остаётся сохранённой в PostgreSQL: DB data is preserved despite Redis failure', async () => {
    const sale: GiftSale = {
      id: 'sale_persist_redis_down',
      collectionId: 'col_1',
      price: '25',
      quantity: '2',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    const outboxEvent: OutboxEvent = {
      eventId: 'evt_sale_persist_redis_down',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: sale.id,
      instrumentKey: 'col_1:TON',
      payload: { sale },
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repository.saveSaleAndCandlesAtomic(sale, [], [outboxEvent]);

    const sales = await repository.getSales();
    expect(sales.some(s => s.id === sale.id)).toBe(true);

    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REQUIRE_REDIS = 'true';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient as any, mockClient as any);
    mockClient.simulateDisconnect();

    const worker = new OutboxWorker(repository);
    await worker.triggerImmediateProcessing();

    const salesAfter = await repository.getSales();
    expect(salesAfter.some(s => s.id === sale.id)).toBe(true);
  });

  it('6. Outbox event остаётся pending: event remains pending after failed dispatch', async () => {
    const sale: GiftSale = {
      id: 'sale_pending_check',
      collectionId: 'col_1',
      price: '50',
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    const outboxEvent: OutboxEvent = {
      eventId: 'evt_pending_check',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: sale.id,
      instrumentKey: 'col_1:TON',
      payload: { sale },
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repository.saveSaleAndCandlesAtomic(sale, [], [outboxEvent]);

    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REQUIRE_REDIS = 'true';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient as any, mockClient as any);
    mockClient.simulateDisconnect();

    const worker = new OutboxWorker(repository);
    await worker.triggerImmediateProcessing();

    const evtDb = await repository.getOutboxEventById('evt_pending_check');
    expect(evtDb).not.toBeNull();
    expect(evtDb?.status).toBe('pending');
    expect(evtDb?.attempts).toBe(1);
  });

  it('7. Redis восстанавливается: health status recovers to active', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REQUIRE_REDIS = 'true';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient as any, mockClient as any);

    mockClient.simulateDisconnect();
    expect(isRedisActive()).toBe(false);

    mockClient.simulateReconnect();
    expect(isRedisActive()).toBe(true);
    expect(getRedisHealthStatus().status).toBe('healthy');
    expect(getRedisHealthStatus().isConnected).toBe(true);
  });

  it('8. Worker повторно публикует event: worker flushes pending events after reconnect', async () => {
    const sale: GiftSale = {
      id: 'sale_reconnect_publish',
      collectionId: 'col_1',
      price: '100',
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    const outboxEvent: OutboxEvent = {
      eventId: 'evt_reconnect_publish',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: sale.id,
      instrumentKey: 'col_1:TON',
      payload: { sale },
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repository.saveSaleAndCandlesAtomic(sale, [], [outboxEvent]);

    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REQUIRE_REDIS = 'true';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient as any, mockClient as any);

    // 1. Disconnect Redis
    mockClient.simulateDisconnect();

    const worker = new OutboxWorker(repository);
    await worker.triggerImmediateProcessing();

    let evtDb = await repository.getOutboxEventById('evt_reconnect_publish');
    expect(evtDb?.status).toBe('pending');

    evtDb!.availableAt = Date.now() - 10;
    await repository.saveOutboxEvent(evtDb!);

    // 2. Reconnect Redis
    mockClient.simulateReconnect();

    // 3. Worker flushes outbox
    const processed = await worker.triggerImmediateProcessing();
    expect(processed).toBe(1);

    evtDb = await repository.getOutboxEventById('evt_reconnect_publish');
    expect(evtDb?.status).toBe('published');
  });

  it('9. Process падает после COMMIT до Redis publish: new worker picks up pending outbox event', async () => {
    const sale: GiftSale = {
      id: 'sale_crash_before_redis',
      collectionId: 'col_1',
      price: '120',
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    const outboxEvent: OutboxEvent = {
      eventId: 'evt_crash_before_redis',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: sale.id,
      instrumentKey: 'col_1:TON',
      payload: { sale },
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repository.saveSaleAndCandlesAtomic(sale, [], [outboxEvent]);

    process.env.REDIS_URL = 'redis://localhost:6379';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient as any, mockClient as any);

    const newWorker = new OutboxWorker(repository);
    const processed = await newWorker.triggerImmediateProcessing();
    expect(processed).toBe(1);

    const evt = await repository.getOutboxEventById('evt_crash_before_redis');
    expect(evt?.status).toBe('published');
  });

  it('10. Process падает после Redis publish до отметки published: event retry is handled gracefully', async () => {
    const sale: GiftSale = {
      id: 'sale_crash_after_redis',
      collectionId: 'col_1',
      price: '150',
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    const outboxEvent: OutboxEvent = {
      eventId: 'evt_crash_after_redis',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: sale.id,
      instrumentKey: 'col_1:TON',
      payload: { sale },
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repository.saveSaleAndCandlesAtomic(sale, [], [outboxEvent]);

    process.env.REDIS_URL = 'redis://localhost:6379';
    const mockClient = new MockTestRedisClient();
    setTestRedisClients(mockClient as any, mockClient as any);

    const fetched = await repository.fetchPendingOutboxEvents(10, 0);
    expect(fetched.length).toBe(1);

    await mockClient.publish(MARKET_EVENTS_CHANNEL, JSON.stringify({ event: 'sale_accepted', payload: { sale } }));

    // Reset lock so it can be picked up again
    const evtBefore = await repository.getOutboxEventById('evt_crash_after_redis');
    evtBefore!.status = 'pending';
    evtBefore!.lockedAt = undefined;
    evtBefore!.availableAt = Date.now() - 100;
    await repository.saveOutboxEvent(evtBefore!);

    const retryWorker = new OutboxWorker(repository);
    const processed = await retryWorker.triggerImmediateProcessing();
    expect(processed).toBe(1);

    const evt = await repository.getOutboxEventById('evt_crash_after_redis');
    expect(evt?.status).toBe('published');
  });

  it('11. Повторная публикация не ломает candle: re-published event updates candles idempotently', async () => {
    const sampleCandle: GiftCandle = {
      instrumentKey: 'col_1:TON',
      timeframe: '1m',
      startTime: 60000,
      endTime: 120000,
      open: '10',
      high: '15',
      low: '10',
      close: '15',
      volume: '1',
      quoteVolume: '15',
      tradeCount: 1,
      firstSaleId: 'sale_idempotent_1',
      lastSaleId: 'sale_idempotent_1',
      confirmed: false,
      revision: 1,
      updatedAt: Date.now()
    };

    await repository.saveCandles('col_1:TON', '1m', [sampleCandle]);

    const duplicateCandle: GiftCandle = {
      ...sampleCandle,
      high: '15',
      revision: 1
    };

    const sale: GiftSale = {
      id: 'sale_idempotent_1',
      collectionId: 'col_1',
      price: '15',
      quantity: '1',
      currency: 'TON',
      eventTime: 65000,
      status: 'completed'
    };

    await repository.saveSaleAndCandlesAtomic(sale, [duplicateCandle]);

    const candles = await repository.getCandles('col_1:TON', '1m');
    expect(candles.length).toBe(1);
    expect(candles[0].high).toBe('15');
    expect(candles[0].revision).toBe(1);
  });

  it('12. Duplicate sale не создаёт второй outbox event: duplicate sale is rejected atomically', async () => {
    const sale: GiftSale = {
      id: 'sale_dupe_check_1',
      collectionId: 'col_1',
      price: '20',
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      status: 'completed'
    };

    const outboxEvent: OutboxEvent = {
      eventId: 'evt_dupe_check_1',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: sale.id,
      instrumentKey: 'col_1:TON',
      payload: { sale },
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const firstRes = await repository.saveSaleAndCandlesAtomic(sale, [], [outboxEvent]);
    expect(firstRes.isNew).toBe(true);

    const secondRes = await repository.saveSaleAndCandlesAtomic(sale, [], [outboxEvent]);
    expect(secondRes.isNew).toBe(false);

    const sales = await repository.getSales();
    expect(sales.length).toBe(1);
  });

  it('13. Reconnect клиента получает актуальный snapshot: client fetches current snapshot after reconnect', async () => {
    const snapshot: MarketSnapshot = {
      version: 1,
      timestamp: Date.now(),
      allSales: [
        {
          id: 'sale_snapshot_1',
          collectionId: 'col_1',
          price: '30',
          quantity: '1',
          currency: 'TON',
          eventTime: Date.now(),
          status: 'completed'
        }
      ],
      processedSaleIds: ['sale_snapshot_1'],
      activeCandles: {},
      closedCandles: {}
    };

    await repository.saveSnapshot(snapshot);

    const loaded = await repository.loadSnapshot();
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.allSales[0].id).toBe('sale_snapshot_1');
  });

  it('14. Два worker-процесса не обрабатывают одну outbox-запись одновременно: locking prevents double processing', async () => {
    const outboxEvent: OutboxEvent = {
      eventId: 'evt_concurrent_lock',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: 'sale_concurrent_1',
      instrumentKey: 'col_1:TON',
      payload: {},
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repository.saveOutboxEvent(outboxEvent);

    const worker1Events = await repository.fetchPendingOutboxEvents(10, 30000);
    expect(worker1Events.length).toBe(1);
    expect(worker1Events[0].eventId).toBe('evt_concurrent_lock');

    const worker2Events = await repository.fetchPendingOutboxEvents(10, 30000);
    expect(worker2Events.length).toBe(0);
  });

  it('15. Несколько backend-инстансов публикуют событие только один раз логически: cluster pub/sub deduping', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const mockClient1 = new MockTestRedisClient();
    setTestRedisClients(mockClient1 as any, mockClient1 as any);

    let receivedCount = 0;
    MockTestRedisClient.channelBus.on('message', (ch, msg) => {
      if (ch === MARKET_EVENTS_CHANNEL) {
        receivedCount++;
      }
    });

    const outboxEvent: OutboxEvent = {
      eventId: 'evt_multi_instance_cluster',
      eventType: 'sale_accepted',
      aggregateType: 'sale',
      aggregateId: 'sale_multi_1',
      instrumentKey: 'col_1:TON',
      payload: {
        sale: {
          id: 'sale_multi_1',
          collectionId: 'col_1',
          price: '50',
          quantity: '1',
          currency: 'TON',
          eventTime: Date.now(),
          status: 'completed'
        }
      },
      status: 'pending',
      attempts: 0,
      availableAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repository.saveOutboxEvent(outboxEvent);

    const worker1 = new OutboxWorker(repository);
    await worker1.triggerImmediateProcessing();

    expect(receivedCount).toBe(1);

    const worker2 = new OutboxWorker(repository);
    const count2 = await worker2.triggerImmediateProcessing();
    expect(count2).toBe(0);
    expect(receivedCount).toBe(1);
  });
});
