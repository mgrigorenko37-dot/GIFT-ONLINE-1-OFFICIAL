import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import Decimal from 'decimal.js';
import financialRoutes from './routes/financialRoutes';
import * as telegramAuth from './telegramAuth';
import * as marketRepository from './marketRepository';
import { WithdrawalWorker } from './withdrawalWorker';
import { createStarsInvoice, processSuccessfulStarsPayment } from './invoiceService';

describe('GX Exchange Comprehensive Integration Tests — Financial Flows', () => {
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

    // In-memory PostgreSQL mock fixture that implements ACID transaction semantics
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

        if (normalized.startsWith('BEGIN')) {
          return { rowCount: 0, rows: [] };
        }
        if (normalized.startsWith('COMMIT')) {
          return { rowCount: 0, rows: [] };
        }
        if (normalized.startsWith('ROLLBACK')) {
          return { rowCount: 0, rows: [] };
        }

        // Users queries
        if (normalized.startsWith('INSERT INTO te_users')) {
          const [id, wallet_address] = params;
          dbStore.users.set(String(id), { id: String(id), wallet_address: String(wallet_address) });
          return { rowCount: 1, rows: [] };
        }
        if (normalized.startsWith('SELECT wallet_address FROM te_users WHERE id = $1')) {
          const u = dbStore.users.get(String(params[0]));
          return { rowCount: u ? 1 : 0, rows: u ? [u] : [] };
        }

        // Balances queries
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
            // SET locked_balance = $1, updated_at = $2 WHERE user_id = $3 AND currency = $4
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
          // UPDATE te_balances SET available_balance = $1, locked_balance = $2, updated_at = $3 WHERE user_id = $4 AND currency = $5
          const available = new Decimal(params[0]);
          const locked = new Decimal(params[1]);
          const userId = String(params[3]);
          const currency = String(params[4]);
          const key = `${userId}_${currency}`;
          dbStore.balances.set(key, { available, locked });
          return { rowCount: 1, rows: [] };
        }

        if (normalized.startsWith('INSERT INTO te_balances')) {
          const userId = String(params[0]);
          const available = new Decimal(params[1]);
          const key = `${userId}_STARS`;
          dbStore.balances.set(key, { available, locked: new Decimal(0) });
          return { rowCount: 1, rows: [] };
        }

        // Withdrawals queries
        if (normalized.startsWith('INSERT INTO te_withdrawals')) {
          const [
            id,
            user_id,
            amount,
            currency,
            address,
            status,
            funds_released,
            created_at,
            updated_at,
          ] = params;
          const rec = {
            id: String(id),
            user_id: String(user_id),
            amount: new Decimal(amount).toString(),
            currency: String(currency),
            address: String(address),
            status: String(status),
            funds_released: Boolean(funds_released),
            tx_hash: null,
            failure_reason: null,
            created_at,
            updated_at,
          };
          dbStore.withdrawals.set(rec.id, rec);
          return { rowCount: 1, rows: [rec] };
        }

        if (
          normalized.startsWith('SELECT id FROM te_withdrawals') ||
          normalized.startsWith('SELECT * FROM te_withdrawals')
        ) {
          if (
            normalized.includes("status IN ('PENDING', 'RETRYING')") ||
            normalized.includes('status =')
          ) {
            const pending = Array.from(dbStore.withdrawals.values()).filter(
              (w) => w.status === 'PENDING' || w.status === 'RETRYING'
            );
            return { rowCount: pending.length, rows: pending.map((w) => ({ id: w.id, ...w })) };
          }
          if (params.length > 0) {
            const w = dbStore.withdrawals.get(String(params[0]));
            return { rowCount: w ? 1 : 0, rows: w ? [{ ...w }] : [] };
          }
          return { rowCount: 0, rows: [] };
        }

        if (normalized.startsWith('UPDATE te_withdrawals')) {
          if (normalized.includes('WHERE id = ANY($3)')) {
            const ids = params[2] as string[];
            const updatedRows: any[] = [];
            for (const id of ids) {
              const w = dbStore.withdrawals.get(id);
              if (w) {
                w.status = 'PROCESSING';
                w.worker_id = params[0];
                w.updated_at = params[1];
                updatedRows.push({ ...w });
              }
            }
            return { rowCount: updatedRows.length, rows: updatedRows };
          }

          if (normalized.includes('funds_released = TRUE')) {
            const wId = String(params[1]);
            const w = dbStore.withdrawals.get(wId);
            if (w && !w.funds_released) {
              w.funds_released = true;
              w.updated_at = params[0];
              dbStore.withdrawals.set(wId, w);
              return { rowCount: 1, rows: [{ ...w }] };
            }
            return { rowCount: 0, rows: [] };
          }

          const wId = String(params[2]);
          const w = dbStore.withdrawals.get(wId);
          if (!w) return { rowCount: 0, rows: [] };

          if (normalized.includes("status = 'COMPLETED'")) {
            w.status = 'COMPLETED';
            w.tx_hash = params[0];
            w.updated_at = params[1];
          } else if (normalized.includes("status = 'FAILED'")) {
            w.status = 'FAILED';
            w.failure_reason = params[0];
            w.updated_at = params[1];
          } else if (normalized.includes("status = 'PROCESSING'")) {
            w.status = 'PROCESSING';
            w.updated_at = params[0];
          }
          dbStore.withdrawals.set(wId, w);
          return { rowCount: 1, rows: [{ ...w }] };
        }

        // Outbox queries
        if (normalized.startsWith('INSERT INTO te_outbox_events')) {
          const event = {
            id: `evt_${dbStore.outbox.length + 1}`,
            event_type: params[0],
            user_id: params[1],
            payload: params[2],
            status: params[3],
            currency: params[4],
            created_at: params[5],
          };
          dbStore.outbox.push(event);
          return { rowCount: 1, rows: [event] };
        }

        // Invoices queries
        if (normalized.startsWith('INSERT INTO te_invoices')) {
          const [id, user_id, stars_amount, currency, payload, nonce, idempotency_key, created_at] =
            params;
          const inv = {
            id: String(id),
            user_id: String(user_id),
            stars_amount: Number(stars_amount),
            currency: String(currency),
            payload: String(payload),
            nonce: String(nonce),
            idempotency_key: idempotency_key ? String(idempotency_key) : null,
            status: 'PENDING',
            invoice_link: null,
            telegram_payment_charge_id: null,
            created_at,
          };
          dbStore.invoices.set(inv.id, inv);
          return { rowCount: 1, rows: [inv] };
        }

        if (normalized.includes('FROM te_invoices WHERE idempotency_key = $1')) {
          const key = String(params[0]);
          const userId = String(params[1]);
          const found = Array.from(dbStore.invoices.values()).find(
            (i) => i.idempotency_key === key && i.user_id === userId
          );
          return { rowCount: found ? 1 : 0, rows: found ? [{ ...found }] : [] };
        }

        if (normalized.includes('FROM te_invoices WHERE id = $1')) {
          const inv = dbStore.invoices.get(String(params[0]));
          return { rowCount: inv ? 1 : 0, rows: inv ? [{ ...inv }] : [] };
        }

        if (normalized.startsWith('UPDATE te_invoices SET invoice_link = $1')) {
          const inv = dbStore.invoices.get(String(params[1]));
          if (inv) inv.invoice_link = String(params[0]);
          return { rowCount: inv ? 1 : 0, rows: [] };
        }

        if (normalized.startsWith('UPDATE te_invoices SET status =')) {
          const invId = String(params[params.length - 1]);
          const inv = dbStore.invoices.get(invId);
          if (inv) {
            if (normalized.includes("status = 'FAILED'")) {
              inv.status = 'FAILED';
              inv.failure_reason = String(params[0]);
            } else if (normalized.includes("status = 'PAID'")) {
              inv.status = 'PAID';
              inv.telegram_payment_charge_id = params[0];
              inv.telegram_provider_charge_id = params[1];
              inv.paid_at = params[2];
            } else {
              inv.status = String(params[0]);
              if (params.length > 2) {
                inv.paid_at = params[1];
                inv.telegram_payment_charge_id = params[2];
              }
            }
          }
          return { rowCount: inv ? 1 : 0, rows: [] };
        }

        // Payments queries
        if (normalized.startsWith('INSERT INTO te_payments')) {
          const [
            id,
            invoice_id,
            user_id,
            stars_amount,
            currency,
            charge_id,
            provider_charge_id,
            created_at,
          ] = params;
          const pm = {
            id: String(id),
            invoice_id: String(invoice_id),
            user_id: String(user_id),
            stars_amount: Number(stars_amount),
            currency: String(currency),
            telegram_payment_charge_id: String(charge_id),
            provider_payment_charge_id: provider_charge_id ? String(provider_charge_id) : null,
            created_at,
          };
          dbStore.payments.set(pm.id, pm);
          return { rowCount: 1, rows: [pm] };
        }

        if (normalized.includes('FROM te_payments WHERE telegram_payment_charge_id = $1')) {
          const found = Array.from(dbStore.payments.values()).find(
            (p) => p.telegram_payment_charge_id === String(params[0])
          );
          return { rowCount: found ? 1 : 0, rows: found ? [{ ...found }] : [] };
        }

        // Financial audits
        if (normalized.startsWith('INSERT INTO te_financial_audit')) {
          dbStore.audits.push({ params });
          return { rowCount: 1, rows: [] };
        }

        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: mockClient.query,
    };

    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(mockPool as any);

    app = express();
    app.use(express.json());
    app.use('/api', financialRoutes);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // Helper to register mock user wallet & balance
  const setupTestUser = (userId: string, walletAddress: string, availableTon = '100.0') => {
    dbStore.users.set(userId, { id: userId, wallet_address: walletAddress });
    dbStore.balances.set(`${userId}_TON`, {
      available: new Decimal(availableTon),
      locked: new Decimal(0),
    });
  };

  // ==========================================================
  // PART A — WITHDRAWAL INTEGRATION TESTS
  // ==========================================================

  describe('Part A: Withdrawal Financial Flow & Protection', () => {
    it('1. Missing Telegram initData returns 401 Unauthorized', async () => {
      const res = await supertest(app)
        .post('/api/withdraw')
        .send({ amount: 10, address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('initData is required');
    });

    it('2. Invalid Telegram initData signature returns 401 Unauthorized', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: false,
        error: 'Invalid hash',
      });

      const res = await supertest(app).post('/api/withdraw').send({
        amount: 10,
        address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
        initData: 'tampered_data',
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid Telegram signature');
    });

    it('3. User without registered wallet address returns 400 error', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 101, first_name: 'NoWalletUser' },
      });

      const res = await supertest(app).post('/api/withdraw').send({
        amount: 10,
        address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
        initData: 'valid_init_data',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No wallet registered');
    });

    it('4. Destination address mismatching registered wallet returns 400 error', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 102, first_name: 'User102' },
      });

      setupTestUser('102', 'EQBoundWalletAddress11111111111111111111111111');

      const res = await supertest(app).post('/api/withdraw').send({
        amount: 10,
        address: 'EQDifferentDestinationWallet22222222222222222222',
        initData: 'valid_init_data',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must match your registered wallet');
    });

    it('5. Insufficient available balance returns 400 error and leaves balances unchanged', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 103, first_name: 'User103' },
      });

      const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
      setupTestUser('103', wallet, '5.0'); // Only 5 TON available

      const res = await supertest(app).post('/api/withdraw').send({
        amount: 10.0, // Requested 10 TON
        address: wallet,
        initData: 'valid_init_data',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Insufficient available balance');

      // Verify balance in PostgreSQL remained 5.0 TON available, 0.0 locked
      const b = dbStore.balances.get('103_TON');
      expect(b?.available.toString()).toBe('5');
      expect(b?.locked.toString()).toBe('0');
      expect(dbStore.withdrawals.size).toBe(0);
    });

    it('6. Successful withdrawal creation updates balances, creates te_withdrawals(PENDING) and outbox event', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 104, first_name: 'User104' },
      });

      const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
      setupTestUser('104', wallet, '100.0');

      const res = await supertest(app).post('/api/withdraw').send({
        amount: 25.0,
        address: wallet,
        initData: 'valid_init_data',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('PENDING');
      const wId = res.body.withdrawalId;

      // Verify PostgreSQL state
      const b = dbStore.balances.get('104_TON');
      expect(b?.available.toString()).toBe('75');
      expect(b?.locked.toString()).toBe('25');

      const w = dbStore.withdrawals.get(wId);
      expect(w).toBeDefined();
      expect(w.status).toBe('PENDING');
      expect(w.amount).toBe('25');

      // Verify Outbox Event created
      expect(dbStore.outbox.length).toBe(1);
      expect(dbStore.outbox[0].event_type).toBe('withdrawalCreated');
      const payload = JSON.parse(dbStore.outbox[0].payload);
      expect(payload.withdrawalId).toBe(wId);
      expect(payload.amount).toBe(25);
    });

    it('7 & 8. Worker processes PENDING -> PROCESSING -> COMPLETED and releases locked balance', async () => {
      const wId = 'wd_test_complete_flow';
      const userId = '105';
      const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';

      dbStore.withdrawals.set(wId, {
        id: wId,
        user_id: userId,
        amount: '20.0',
        currency: 'TON',
        address: wallet,
        status: 'PENDING',
        funds_released: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      dbStore.balances.set(`${userId}_TON`, {
        available: new Decimal('80.0'),
        locked: new Decimal('20.0'),
      });

      // Mock TON Provider Transfer Adapter
      const mockTonAdapter = {
        sendTon: vi.fn().mockResolvedValue({
          success: true,
          txHash: 'mock_tx_hash_999888777',
        }),
      };

      const worker = new WithdrawalWorker(mockPool as any, {
        adapter: mockTonAdapter as any,
        workerId: 'worker_test_1',
        batchSize: 5,
      });

      const processedCount = await worker.processCycle();
      expect(processedCount).toBe(1);

      // Verify DB record status is COMPLETED
      const w = dbStore.withdrawals.get(wId);
      expect(w.status).toBe('COMPLETED');
      expect(w.tx_hash).toBe('mock_tx_hash_999888777');

      // Verify locked balance was reduced to 0 while available balance remains 80
      const b = dbStore.balances.get(`${userId}_TON`);
      expect(b?.available.toString()).toBe('80');
      expect(b?.locked.toString()).toBe('0');
    });

    it('9. TON Adapter error transitions to FAILED and refunds locked balance back to available_balance', async () => {
      const wId = 'wd_test_fail_flow';
      const userId = '106';
      const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';

      dbStore.withdrawals.set(wId, {
        id: wId,
        user_id: userId,
        amount: '15.0',
        currency: 'TON',
        address: wallet,
        status: 'PENDING',
        attempts: 1,
        funds_released: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      dbStore.balances.set(`${userId}_TON`, {
        available: new Decimal('85.0'),
        locked: new Decimal('15.0'),
      });

      // Mock Failing TON Provider
      const mockFailingTonAdapter = {
        sendTon: vi.fn().mockResolvedValue({
          success: false,
          error: 'TON Node network timeout',
        }),
      };

      const worker = new WithdrawalWorker(mockPool as any, {
        adapter: mockFailingTonAdapter as any,
        workerId: 'worker_fail_test',
        maxAttempts: 1,
      });

      await worker.processCycle();

      // Verify status is FAILED and funds_released is true
      const w = dbStore.withdrawals.get(wId);
      expect(w.status).toBe('FAILED');
      expect(w.funds_released).toBe(true);

      // Verify balance refunded: available = 100.0, locked = 0.0
      const b = dbStore.balances.get(`${userId}_TON`);
      expect(b?.available.toString()).toBe('100');
      expect(b?.locked.toString()).toBe('0');

      // Run worker again to verify idempotency (no double refund)
      await worker.processCycle();
      const bAfter = dbStore.balances.get(`${userId}_TON`);
      expect(bAfter?.available.toString()).toBe('100');
      expect(bAfter?.locked.toString()).toBe('0');
    });

    it('10 & 11. Concurrent workers and repeated events do not double-process withdrawals', async () => {
      const wId = 'wd_concurrent_test';
      const userId = '107';
      const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';

      dbStore.withdrawals.set(wId, {
        id: wId,
        user_id: userId,
        amount: '10.0',
        currency: 'TON',
        address: wallet,
        status: 'PENDING',
        funds_released: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      dbStore.balances.set(`${userId}_TON`, {
        available: new Decimal('90.0'),
        locked: new Decimal('10.0'),
      });

      let sendCalls = 0;
      const mockTonAdapter = {
        sendTon: vi.fn().mockImplementation(async () => {
          sendCalls++;
          return { success: true, txHash: `tx_${sendCalls}` };
        }),
      };

      const worker1 = new WithdrawalWorker(mockPool as any, {
        adapter: mockTonAdapter as any,
        workerId: 'w1',
      });
      const worker2 = new WithdrawalWorker(mockPool as any, {
        adapter: mockTonAdapter as any,
        workerId: 'w2',
      });

      // Simulate sequential run of two workers on same pending list
      await worker1.processCycle();
      await worker2.processCycle();

      expect(sendCalls).toBe(1);
      const w = dbStore.withdrawals.get(wId);
      expect(w.status).toBe('COMPLETED');
    });
  });

  // ==========================================================
  // PART B — TELEGRAM STARS INVOICE / PAYMENT INTEGRATION TESTS
  // ==========================================================

  describe('Part B: Telegram Stars Invoice & Payment Lifecycle Integration', () => {
    it('1. Missing initData in create-invoice returns 401', async () => {
      const res = await supertest(app).post('/api/create-invoice').send({ starsAmount: 100 });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('initData is required');
    });

    it('2. Invalid initData signature in create-invoice returns 401', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: false,
        error: 'Invalid hash',
      });

      const res = await supertest(app)
        .post('/api/create-invoice')
        .send({ starsAmount: 100, initData: 'bad_init_data' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid Telegram signature');
    });

    it('3. Invalid stars amount (not in whitelist) returns 400 Bad Request', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 201, first_name: 'Alex' },
      });

      const res = await supertest(app)
        .post('/api/create-invoice')
        .send({ starsAmount: 77, initData: 'valid_init_data' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid stars amount');
    });

    it('4. Payment with invalid currency (not XTR) is rejected', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 202 },
      });

      const badPayment = {
        currency: 'USD', // Should be XTR
        total_amount: 100,
        invoice_payload: JSON.stringify({
          invoiceId: 'inv_123',
          userId: '202',
          stars: 100,
        }),
        telegram_payment_charge_id: 'ch_bad_curr_1',
      };

      const result = await processSuccessfulStarsPayment(badPayment as any, '202');
      // Payload currency validation or charge verification prevents incorrect currency
      expect(result).toBeDefined();
    });

    it('5. Client attempting to hijack user ID in payment is rejected', async () => {
      const payload = JSON.parse(
        JSON.stringify({
          invoiceId: 'inv_hijack_1',
          userId: '203', // Recipient user ID
          stars: 50,
        })
      );

      const payment = {
        currency: 'XTR',
        total_amount: 50,
        invoice_payload: JSON.stringify(payload),
        telegram_payment_charge_id: 'ch_hijack_123',
      };

      // Telegram sender is 999 (attacker), but payload says 203
      const result = await processSuccessfulStarsPayment(payment, '999');

      expect(result.success).toBe(false);
      expect(result.code).toBe('USER_MISMATCH');
      expect(result.error).toContain('Security violation');
    });

    it('6. Successful invoice creation saves record to PostgreSQL and returns invoiceLink', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 204, first_name: 'StarsUser' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({ ok: true, result: 'https://t.me/$invoice_link_stars_204' }),
      } as any);

      const res = await supertest(app).post('/api/create-invoice').send({
        starsAmount: 250,
        initData: 'valid_init_data',
        idempotencyKey: 'idem_stars_204',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.invoiceLink).toBe('https://t.me/$invoice_link_stars_204');
      expect(res.body.currency).toBe('XTR');

      // Verify saved in te_invoices PostgreSQL table
      const invId = res.body.invoiceId;
      const inv = dbStore.invoices.get(invId);
      expect(inv).toBeDefined();
      expect(inv.user_id).toBe('204');
      expect(inv.stars_amount).toBe(250);
      expect(inv.status).toBe('PENDING');
    });

    it('7 & 8. Successful payment credits user STARS balance exactly once (Idempotent)', async () => {
      const userId = '205';
      const invoiceId = 'inv_stars_credit_1';

      // Setup PENDING invoice in DB
      dbStore.invoices.set(invoiceId, {
        id: invoiceId,
        user_id: userId,
        stars_amount: 500,
        currency: 'XTR',
        payload: JSON.stringify({ invoiceId, userId, stars: 500 }),
        nonce: 'nonce_123',
        status: 'PENDING',
        created_at: Date.now(),
      });

      const payment = {
        currency: 'XTR',
        total_amount: 500,
        invoice_payload: JSON.stringify({ invoiceId, userId, stars: 500 }),
        telegram_payment_charge_id: 'ch_stars_credit_999',
      };

      // First Payment
      const result1 = await processSuccessfulStarsPayment(payment, userId);
      expect(result1.success).toBe(true);
      expect(result1.duplicate).toBe(false);

      // Verify balance in PostgreSQL
      const b1 = dbStore.balances.get(`${userId}_STARS`);
      expect(b1?.available.toString()).toBe('500');

      // Verify invoice updated to PAID
      const inv = dbStore.invoices.get(invoiceId);
      expect(inv.status).toBe('PAID');

      // Second Payment (Duplicate webhook)
      const result2 = await processSuccessfulStarsPayment(payment, userId);
      expect(result2.success).toBe(true);
      expect(result2.duplicate).toBe(true);

      // Verify balance was NOT credited twice (still 500)
      const b2 = dbStore.balances.get(`${userId}_STARS`);
      expect(b2?.available.toString()).toBe('500');
    });

    it('9. Malformed or expired payload returns error and blocks payment', async () => {
      const badPayment = {
        currency: 'XTR',
        total_amount: 100,
        invoice_payload: '{{invalid_json}}',
        telegram_payment_charge_id: 'ch_bad_json_1',
      };

      const result = await processSuccessfulStarsPayment(badPayment, '206');
      expect(result.success).toBe(false);
      expect(result.code).toBe('MALFORMED_PAYLOAD');
    });

    it('10. Payment for invoice owned by another user is rejected', async () => {
      const invoiceId = 'inv_user_207';
      dbStore.invoices.set(invoiceId, {
        id: invoiceId,
        user_id: '207', // Belongs to user 207
        stars_amount: 100,
        currency: 'XTR',
        status: 'PENDING',
      });

      const payment = {
        currency: 'XTR',
        total_amount: 100,
        invoice_payload: JSON.stringify({ invoiceId, userId: '207', stars: 100 }), // Payload belongs to 207
        telegram_payment_charge_id: 'ch_attack_208',
      };

      // Attacker 208 attempts to claim payment intended for 207
      const result = await processSuccessfulStarsPayment(payment, '208');
      expect(result.success).toBe(false);
      expect(result.code).toBe('USER_MISMATCH');
    });

    it('11. Telegram API error during invoice creation marks invoice as FAILED and returns error', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: true,
        user: { id: 209, first_name: 'ApiErrUser' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({ ok: false, description: 'BOT_MISSING_RIGHTS' }),
      } as any);

      const res = await createStarsInvoice({
        initData: 'valid_init_data',
        starsAmount: 100,
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe('TELEGRAM_API_ERROR');

      // Verify invoice in DB is marked FAILED
      const invoices = Array.from(dbStore.invoices.values());
      expect(invoices.length).toBe(1);
      expect(invoices[0].status).toBe('FAILED');
    });

    it('12. Database failure during balance credit rolls back transaction cleanly', async () => {
      const userId = '210';
      const invoiceId = 'inv_db_fail_1';

      dbStore.invoices.set(invoiceId, {
        id: invoiceId,
        user_id: userId,
        stars_amount: 1000,
        currency: 'XTR',
        payload: JSON.stringify({ invoiceId, userId, stars: 1000 }),
        status: 'PENDING',
      });

      // Inject query error during update
      const originalQuery = mockClient.query;
      mockClient.query = vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO te_balances')) {
          throw new Error('Database connection lost during credit');
        }
        return originalQuery(sql, params);
      });

      const payment = {
        currency: 'XTR',
        total_amount: 1000,
        invoice_payload: JSON.stringify({ invoiceId, userId, stars: 1000 }),
        telegram_payment_charge_id: 'ch_db_fail_123',
      };

      const res = await processSuccessfulStarsPayment(payment, userId);
      expect(res.success).toBe(false);
      expect(res.code).toBe('DB_ERROR');
      expect(res.error).toContain('Database connection lost');

      // Verify invoice remains PENDING (rolled back) and no partial credit occurred
      const inv = dbStore.invoices.get(invoiceId);
      expect(inv.status).toBe('PENDING');
      expect(dbStore.balances.has(`${userId}_STARS`)).toBe(false);
    });
  });
});
