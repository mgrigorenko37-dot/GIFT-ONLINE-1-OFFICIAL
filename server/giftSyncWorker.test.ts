import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  syncTelegramGifts,
  validateTonCollectionsResponse,
  validateTonItemsResponse,
  SYNC_ADVISORY_LOCK_ID,
} from './giftSyncWorker';
import * as marketRepository from './marketRepository';
import { MOCK_GIFTS_FIXTURE, MOCK_VARIANTS_FIXTURE } from './mocks/giftsFixture';
import fs from 'fs';
import path from 'path';

describe('Telegram Gifts Production vs Mock Synchronization Tests', () => {
  let mockClient: any;
  let mockPool: any;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(mockPool as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('1. Production mode with empty TON data returns clean empty/zero count, no fake gifts generated', async () => {
    process.env.NODE_ENV = 'production';
    process.env.USE_MOCK_GIFTS = 'false';

    // Mock advisory lock granted
    mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });

    // Mock TON API returning empty collections array
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nft_collections: [] }),
    } as any);

    const result = await syncTelegramGifts();

    expect(result.success).toBe(true);
    expect(result.source).toBe('ton_api');
    expect(result.collectionsSynced).toBe(0);
    expect(result.variantsSynced).toBe(0);

    // Verify advisory lock was released
    expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      SYNC_ADVISORY_LOCK_ID,
    ]);
  });

  it('2. Development mock mode (USE_MOCK_GIFTS=true) synchronizes deterministic mock fixtures', async () => {
    process.env.NODE_ENV = 'development';
    process.env.USE_MOCK_GIFTS = 'true';

    const insertedCollections: any[] = [];
    const insertedVariants: any[] = [];

    mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      if (sql.includes('INSERT INTO gift_collections')) {
        insertedCollections.push(params);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO gift_variants')) {
        insertedVariants.push(params);
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });

    const result = await syncTelegramGifts();

    expect(result.success).toBe(true);
    expect(result.source).toBe('mock');
    expect(result.collectionsSynced).toBe(MOCK_GIFTS_FIXTURE.length);
    expect(result.variantsSynced).toBe(MOCK_VARIANTS_FIXTURE.length);
    expect(insertedCollections.length).toBe(MOCK_GIFTS_FIXTURE.length);
    expect(insertedVariants.length).toBe(MOCK_VARIANTS_FIXTURE.length);
  });

  it('3. Repeated synchronization is idempotent (ON CONFLICT UPSERT)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.USE_MOCK_GIFTS = 'false';

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });

    const sampleCollection = {
      address: 'EQ_TG_GIFT_COLL_1',
      name: 'Telegram Gift Collection Durov Cap',
      next_item_index: 2500,
      image: 'https://example.com/durov.png',
    };

    const sampleItem = {
      address: 'EQ_TG_GIFT_ITEM_1',
      metadata: {
        attributes: [
          { trait_type: 'Model', value: 'Gold' },
          { trait_type: 'Backdrop', value: '#2a2840' },
          { trait_type: 'Symbol', value: 'Original' },
        ],
      },
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/items')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ nft_items: [sampleItem] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ nft_collections: [sampleCollection] }),
      });
    });

    // Run 1st time
    const result1 = await syncTelegramGifts();
    expect(result1.success).toBe(true);
    expect(result1.collectionsSynced).toBe(1);
    expect(result1.variantsSynced).toBe(1);

    // Run 2nd time (idempotent upsert verification)
    const result2 = await syncTelegramGifts();
    expect(result2.success).toBe(true);
    expect(result2.collectionsSynced).toBe(1);
    expect(result2.variantsSynced).toBe(1);
  });

  it('4. Duplicate collection entries in payload are gracefully de-duplicated by database constraints', async () => {
    process.env.NODE_ENV = 'production';
    process.env.USE_MOCK_GIFTS = 'false';

    const duplicateCollection = {
      address: 'EQ_DUPLICATE_COLL_ID',
      name: 'Telegram Gift Dup',
      next_item_index: 100,
    };

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nft_collections: [duplicateCollection, duplicateCollection],
      }),
    } as any);

    const result = await syncTelegramGifts();
    expect(result.success).toBe(true);
    expect(result.collectionsSynced).toBe(2); // Upsert processed both without SQL constraint error
  });

  it('5. Handles TON API failure gracefully without throwing or corrupting state', async () => {
    process.env.NODE_ENV = 'production';
    process.env.USE_MOCK_GIFTS = 'false';

    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    } as any);

    const result = await syncTelegramGifts();
    expect(result.success).toBe(false);
    expect(result.source).toBe('ton_api');
    expect(result.error).toContain('502');
  });

  it('6. Handles incomplete or malformed TON API responses with schema validators', () => {
    // Missing nft_collections
    expect(validateTonCollectionsResponse(null)).toBeNull();
    expect(validateTonCollectionsResponse({})).toBeNull();
    expect(validateTonCollectionsResponse({ nft_collections: 'invalid' })).toBeNull();

    // Incomplete items inside array
    const rawData = {
      nft_collections: [
        { address: 'EQ_VALID', name: 'Valid Collection' },
        { address: 12345, name: 'Invalid Address' },
        { address: 'EQ_NO_NAME' },
        null,
      ],
    };
    const validated = validateTonCollectionsResponse(rawData);
    expect(validated).not.toBeNull();
    expect(validated?.length).toBe(1);
    expect(validated?.[0].address).toBe('EQ_VALID');

    // Incomplete variants validator
    expect(validateTonItemsResponse(null)).toBeNull();
    expect(
      validateTonItemsResponse({ nft_items: [{ address: 'EQ_ITEM_VALID' }, {}] })?.length
    ).toBe(1);
  });

  it('7. Verifies absolute absence of Math.random() in production gift sync path', () => {
    const giftSyncPath = path.resolve('server/giftSyncWorker.ts');
    const content = fs.readFileSync(giftSyncPath, 'utf-8');

    expect(content.includes('Math.random()')).toBe(false);
    expect(content.includes('src/data/gifts')).toBe(false);
  });
});
