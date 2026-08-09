import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryMarketRepository, resolveMarketRepository, OutboxEvent } from './marketRepository';
import { acceptCompletedSale, setMarketRepository } from './marketState';
import { OutboxWorker } from './outboxWorker';
import { broadcastSaleResult } from './realtimeManager';

describe('Transactional Outbox & Production Safety Rules', () => {
  let repo: InMemoryMarketRepository;
  let worker: OutboxWorker;

  beforeEach(() => {
    repo = new InMemoryMarketRepository();
    setMarketRepository(repo);
    worker = new OutboxWorker(repo, 50);
  });

  afterEach(() => {
    worker.stop();
  });

  it('should save outbox event atomically when sale is accepted and process it via OutboxWorker', async () => {
    const saleData = {
      id: `test_outbox_${Date.now()}`,
      collectionId: 'gift_star',
      currency: 'TON',
      price: '15.5',
      quantity: '1',
      eventTime: Date.now(),
      status: 'completed',
    };

    const res = acceptCompletedSale(saleData);
    expect(res.accepted).toBe(true);

    const pendingBefore = await repo.getOutboxEventById(`evt_sale_${saleData.id}`);
    expect(pendingBefore).not.toBeNull();
    expect(pendingBefore?.eventId).toBe(`evt_sale_${saleData.id}`);
    expect(pendingBefore?.status).toBe('pending');

    const processed = await worker.triggerImmediateProcessing();
    expect(processed).toBe(1);

    const eventInDb = await repo.getOutboxEventById(`evt_sale_${saleData.id}`);
    expect(eventInDb?.status).toBe('published');
    expect(eventInDb?.publishedAt).toBeDefined();
  });

  it('should strictly throw error when Redis is required in production and inactive, preventing dangerous silent local fallback', async () => {
    const originalEnv = process.env.REQUIRE_REDIS;
    const originalNodeEnv = process.env.NODE_ENV;

    try {
      process.env.REQUIRE_REDIS = 'true';
      process.env.NODE_ENV = 'production';

      const mockResult = {
        accepted: true,
        reason: 'accepted' as const,
        sale: {
          id: 'test_sale',
          collectionId: 'gift_star',
          price: '10',
          quantity: '1',
          currency: 'TON' as const,
          eventTime: Date.now(),
          createdAt: Date.now(),
          status: 'completed' as const,
          isMock: false
        }
      };

      await expect(broadcastSaleResult(mockResult)).rejects.toThrow(/Redis is required for cluster realtime synchronization/);
    } finally {
      process.env.REQUIRE_REDIS = originalEnv;
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('should strictly ban file storage in production when DATABASE_URL is missing', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDbUrl = process.env.DATABASE_URL;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;

      expect(() => resolveMarketRepository()).toThrow(/CRITICAL CONFIGURATION ERROR: Production mode requires DATABASE_URL/);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.DATABASE_URL = originalDbUrl;
    }
  });
});
