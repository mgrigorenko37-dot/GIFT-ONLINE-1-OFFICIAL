import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import marketRoutes from './routes/marketRoutes';
import * as marketRepository from './marketRepository';
import { MOCK_GIFTS_FIXTURE } from './mocks/giftsFixture';

describe('Market Routes Collections & Gifts Source Tests', () => {
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

  // Helper to execute route handler directly without supertest
  const executeGetGiftsHandler = async (reqOverride: any = {}) => {
    const route = marketRoutes.stack.find(
      (s: any) =>
        s.route &&
        s.route.path &&
        (s.route.path === '/collections' ||
          (Array.isArray(s.route.path) && s.route.path.includes('/gifts')))
    );
    const handler = (route as any)?.route?.stack?.[0]?.handle;

    let responseData: any = null;
    let statusCode = 200;

    const mockReq = {
      query: {},
      params: {},
      headers: {},
      ...reqOverride,
    };

    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return mockRes;
      },
      json: (data: any) => {
        responseData = data;
        return mockRes;
      },
    };

    const nextFn = () => {};
    await (handler as any)(mockReq, mockRes, nextFn);
    return { status: statusCode, body: responseData };
  };

  it('1. Returns PostgreSQL records with source="postgres" when database has data', async () => {
    process.env.NODE_ENV = 'production';

    const dbRow = {
      id: 'EQ_DB_COLL_1',
      name: 'Real TON Gift',
      total_supply: '500',
      image_url: 'https://cdn.example.com/gift.png',
      floor_price_gx: '150.5',
      created_at: new Date().toISOString(),
    };

    mockClient.query.mockResolvedValue({
      rows: [dbRow],
    });

    const res = await executeGetGiftsHandler();
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('postgres');
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].id).toBe('EQ_DB_COLL_1');
    expect(res.body.data[0].floor).toBe(150.5);
  });

  it('2. Production mode with empty PostgreSQL returns clean empty state, no mock data', async () => {
    process.env.NODE_ENV = 'production';
    process.env.USE_MOCK_GIFTS = 'false';

    mockClient.query.mockResolvedValue({
      rows: [],
    });

    const res = await executeGetGiftsHandler();
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('postgres');
    expect(res.body.count).toBe(0);
    expect(res.body.data).toEqual([]);
    expect(res.body.message).toContain('No gift collections found');
  });

  it('3. Development mode with USE_MOCK_GIFTS=true returns deterministic mock fixtures', async () => {
    process.env.NODE_ENV = 'development';
    process.env.USE_MOCK_GIFTS = 'true';

    mockClient.query.mockResolvedValue({
      rows: [],
    });

    const res = await executeGetGiftsHandler();
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('mock');
    expect(res.body.count).toBe(MOCK_GIFTS_FIXTURE.length);
    expect(res.body.data.length).toBe(MOCK_GIFTS_FIXTURE.length);
    expect(res.body.data[0].id).toBe('plush-pepe');
    expect(res.body.data[0].source).toBe('mock');
  });
});
