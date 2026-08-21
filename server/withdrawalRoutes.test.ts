import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getPgPool } from './marketRepository';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('./marketRepository', () => ({
  getPgPool: vi.fn(() => mockPool),
}));

vi.mock('./telegramAuth', () => ({
  validateTelegramInitData: vi.fn(() => ({
    isValid: true,
    user: { id: 123456789 },
  })),
}));

import financialRoutes from './routes/financialRoutes';

const app = express();
app.use(express.json());
app.use(financialRoutes);

describe('Withdrawal Routes', () => {
  beforeEach(() => {
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockClear();
    (getPgPool as any).mockClear();
  });

  it('should reject duplicate withdrawal requests using idempotencyKey', async () => {
    mockClient.query.mockImplementation(async (sql: string, params: any[]) => {
      console.log('QUERY:', sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('wallet_address')) {
        return { rows: [{ wallet_address: '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8' }] };
      }
      if (sql.includes('available_balance')) {
        return { rows: [{ available_balance: '10.0', locked_balance: '0' }] };
      }
      if (sql.includes('UPDATE te_balances')) {
        return { rowCount: 1 };
      }
      if (sql.includes('INSERT INTO te_withdrawals')) {
        if (params[1] === 'idem_key_123') {
           const err: any = new Error('duplicate key value violates unique constraint');
           err.code = '23505';
           err.constraint = 'te_withdrawals_operation_id_key';
           throw err;
        }
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post('/withdraw')
      .send({
        amount: '1.5',
        address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
        initData: 'query_id=123',
        idempotencyKey: 'idem_key_123'
      });

    console.log(response.body);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_OPERATION');
  });
});

  it('should reject withdrawal to invalid wallet address', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('wallet_address')) {
        return { rows: [{ wallet_address: '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8' }] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post('/withdraw')
      .send({
        amount: '1.5',
        address: 'invalid_address',
        initData: 'query_id=123',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid TON destination wallet');
  });

  it('should reject withdrawal to unmatching wallet address', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('wallet_address')) {
        return { rows: [{ wallet_address: '0:1111111111111111111111111111111111111111111111111111111111111111' }] };
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post('/withdraw')
      .send({
        amount: '1.5',
        address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
        initData: 'query_id=123',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('match your registered wallet');
  });

  it('should reject withdrawal if insufficient balance', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('wallet_address')) {
        return { rows: [{ wallet_address: '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8' }] };
      }
      if (sql.includes('available_balance')) {
        return { rows: [{ available_balance: '1.0', locked_balance: '0' }] }; // Less than requested 1.5
      }
      return { rows: [] };
    });

    const response = await request(app)
      .post('/withdraw')
      .send({
        amount: '1.5',
        address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
        initData: 'query_id=123',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Insufficient available balance');
  });
