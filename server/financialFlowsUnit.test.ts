import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import Decimal from 'decimal.js';
import financialRoutes from './routes/financialRoutes';
import * as telegramAuth from './telegramAuth';
import * as marketRepository from './marketRepository';
import { WithdrawalWorker } from './withdrawalWorker';
import { createStarsInvoice, processSuccessfulStarsPayment } from './invoiceService';

describe('Financial Flows Unit Tests (Mock SQL Adapter)', () => {
  let app: express.Application;
  let mockClient: any;
  let mockPool: any;
  let dbStore: {
    users: Map<string, any>;
    balances: Map<string, { available: Decimal; locked: Decimal }>;
    withdrawals: Map<string, any>;
    invoices: Map<string, any>;
    payments: Map<string, any>;
    outbox: any[];
    audits: any[];
  };

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      NODE_ENV: 'test',
    };

    dbStore = {
      users: new Map(),
      balances: new Map(),
      withdrawals: new Map(),
      invoices: new Map(),
      payments: new Map(),
      outbox: [],
      audits: [],
    };

    mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();

        if (
          normalized.startsWith('BEGIN') ||
          normalized.startsWith('COMMIT') ||
          normalized.startsWith('ROLLBACK')
        ) {
          return { rowCount: 0, rows: [] };
        }

        if (normalized.startsWith('INSERT INTO te_users')) {
          const [id, wallet_address] = params;
          dbStore.users.set(String(id), { id: String(id), wallet_address: String(wallet_address) });
          return { rowCount: 1, rows: [] };
        }
        if (normalized.startsWith('SELECT wallet_address FROM te_users WHERE id = $1')) {
          const u = dbStore.users.get(String(params[0]));
          return { rowCount: u ? 1 : 0, rows: u ? [u] : [] };
        }

        if (normalized.includes('FROM te_balances WHERE user_id = $1 AND currency = $2')) {
          const key = `${params[0]}_${params[1]}`;
          const b = dbStore.balances.get(key);
          if (!b) return { rowCount: 0, rows: [] };
          return {
            rowCount: 1,
            rows: [
              {
                user_id: String(params[0]),
                currency: String(params[1]),
                available_balance: b.available.toString(),
                locked_balance: b.locked.toString(),
              },
            ],
          };
        }

        if (normalized.startsWith('UPDATE te_balances')) {
          if (normalized.includes('SET locked_balance = $1')) {
            const locked = new Decimal(params[0]);
            const userId = String(params[2]);
            const currency = String(params[3]);
            const key = `${userId}_${currency}`;
            const existing = dbStore.balances.get(key) || {
              available: new Decimal(0),
              locked: new Decimal(0),
            };
            dbStore.balances.set(key, { available: existing.available, locked });
            return { rowCount: 1, rows: [] };
          }

          if (normalized.includes('available_balance = available_balance - $1')) {
            const deduct = new Decimal(params[0]);
            const userId = String(params[2]);
            const currency = String(params[3]);
            const key = `${userId}_${currency}`;
            const existing = dbStore.balances.get(key) || {
              available: new Decimal(0),
              locked: new Decimal(0),
            };
            const newAvail = existing.available.minus(deduct);
            const newLocked = existing.locked.plus(deduct);
            dbStore.balances.set(key, { available: newAvail, locked: newLocked });
            return { rowCount: 1, rows: [] };
          }

          if (normalized.includes('available_balance = available_balance + $1')) {
            const credit = new Decimal(params[0]);
            const userId = String(params[2]);
            const currency = String(params[3]);
            const key = `${userId}_${currency}`;
            const existing = dbStore.balances.get(key) || {
              available: new Decimal(0),
              locked: new Decimal(0),
            };
            dbStore.balances.set(key, {
              available: existing.available.plus(credit),
              locked: existing.locked,
            });
            return { rowCount: 1, rows: [] };
          }
        }

        if (normalized.startsWith('INSERT INTO te_withdrawals')) {
          const [id, opId, userId, amount, currency, address, status] = params;
          const record = {
            id,
            operation_id: opId,
            user_id: userId,
            amount: new Decimal(amount),
            currency,
            address,
            status,
            attempts: 0,
            funds_released: false,
          };
          dbStore.withdrawals.set(String(id), record);
          return { rowCount: 1, rows: [] };
        }

        if (normalized.startsWith('INSERT INTO te_outbox_events')) {
          dbStore.outbox.push({ payload: params[0], event_type: params[1], user_id: params[2] });
          return { rowCount: 1, rows: [] };
        }

        if (normalized.startsWith('INSERT INTO te_financial_audits')) {
          dbStore.audits.push({ event_type: params[0], user_id: params[1], amount: params[2] });
          return { rowCount: 1, rows: [] };
        }

        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn().mockImplementation((sql, params) => mockClient.query(sql, params)),
    };

    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(mockPool);

    app = express();
    app.use(express.json());
    app.use('/api', financialRoutes);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('Unit Test — Route POST /api/withdraw handles authentication and payload validation', async () => {
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: true,
      user: { id: 123456789, first_name: 'Unit' },
    });

    dbStore.users.set('123456789', {
      id: '123456789',
      wallet_address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
    });
    dbStore.balances.set('123456789_TON', {
      available: new Decimal('100.0'),
      locked: new Decimal('0.0'),
    });

    const res = await supertest(app).post('/api/withdraw').send({
      amount: 10.0,
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      initData: 'valid_init_data',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('PENDING');
  });
});
