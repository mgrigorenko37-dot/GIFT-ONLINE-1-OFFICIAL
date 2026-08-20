import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import Decimal from 'decimal.js';
import { Pool, Client } from 'pg';
import financialRoutes from '../../server/routes/financialRoutes';
import * as telegramAuth from '../../server/telegramAuth';
import * as marketRepository from '../../server/marketRepository';
import { WithdrawalWorker } from '../../server/withdrawalWorker';
import { createStarsInvoice, processSuccessfulStarsPayment } from '../../server/invoiceService';
import {
  getTestDbPool,
  closeTestDbPool,
  createSeparateClient,
  createUniqueUserId,
  createUniqueNumericUserId,
  seedTestUser,
  cleanupUserData,
  queryBalance,
  queryWithdrawal,
  queryOutboxEvents,
  queryFinancialAudits,
  queryInvoices,
  queryInvoiceById,
  queryPayments,
  queryPaymentByChargeId,
} from './postgresFixture';

describe('Real PostgreSQL Integration Tests — Financial Flows & Database Integrity', () => {
  let pool: Pool;
  let app: express.Application;
  let createdUserIds: string[] = [];
  const originalEnv = process.env;

  beforeAll(async () => {
    // Fail fast if PostgreSQL is unavailable
    pool = await getTestDbPool();

    // Force marketRepository.getPgPool() to return the real test pool
    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(pool);

    app = express();
    app.use(express.json());
    app.use('/api', financialRoutes);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeTestDbPool();
  });

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      NODE_ENV: 'test',
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
    // Clean up isolated test data from real PostgreSQL tables after each test
    for (const userId of createdUserIds) {
      await cleanupUserData(pool, userId);
    }
    createdUserIds = [];
    vi.restoreAllMocks();
    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(pool);
  });

  // Helper to spawn a new isolated user ID and record it for cleanup
  const spawnTestUser = async (
    walletAddress: string,
    balances: { TON?: string | number; STARS?: string | number } = { TON: '100.0' }
  ) => {
    const userId = createUniqueNumericUserId();
    createdUserIds.push(userId);
    await seedTestUser(pool, userId, walletAddress, balances);
    return userId;
  };

  // Helper to mock valid Telegram authentication signature for a specific user ID
  const mockTelegramAuth = (userId: string) => {
    const numId = Number(userId);
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: true,
      user: { id: numId, first_name: `User_${userId}` },
    });
  };

  // =========================================================================
  // 1. INSUFFICIENT BALANCE
  // =========================================================================
  it('1. Real PostgreSQL — Insufficient balance request rolls back transaction, leaving te_balances unchanged and 0 withdrawals', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '5.0' }); // Only 5.0 TON available
    mockTelegramAuth(userId);

    const res = await supertest(app).post('/api/withdraw').send({
      amount: 10.0, // Requests 10.0 TON
      address: wallet,
      initData: 'valid_init_data',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Insufficient available balance');

    // Assert actual PostgreSQL state in te_balances
    const balance = await queryBalance(pool, userId, 'TON');
    expect(balance).not.toBeNull();
    expect(balance!.available_balance.toString()).toBe('5');
    expect(balance!.locked_balance.toString()).toBe('0');

    // Assert zero rows created in te_withdrawals and te_outbox_events
    const withdrawals = await pool.query('SELECT * FROM te_withdrawals WHERE user_id = $1', [
      userId,
    ]);
    expect(withdrawals.rows.length).toBe(0);

    const outbox = await queryOutboxEvents(pool, userId);
    expect(outbox.length).toBe(0);
  });

  // =========================================================================
  // 2. SUCCESSFUL WITHDRAWAL CREATION
  // =========================================================================
  it('2. Real PostgreSQL — Successful withdrawal updates te_balances, inserts te_withdrawals(PENDING), te_outbox_events, and te_financial_audits', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '100.0' });
    mockTelegramAuth(userId);

    const res = await supertest(app).post('/api/withdraw').send({
      amount: 25.0,
      address: wallet,
      initData: 'valid_init_data',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('PENDING');

    const withdrawalId = res.body.withdrawalId;
    expect(withdrawalId).toBeDefined();

    // Verify te_balances state in PostgreSQL
    const balance = await queryBalance(pool, userId, 'TON');
    expect(balance!.available_balance.toString()).toBe('75');
    expect(balance!.locked_balance.toString()).toBe('25');

    // Verify te_withdrawals row in PostgreSQL
    const withdrawalRow = await queryWithdrawal(pool, withdrawalId);
    expect(withdrawalRow).not.toBeNull();
    expect(withdrawalRow.user_id).toBe(userId);
    expect(withdrawalRow.status).toBe('PENDING');
    expect(new Decimal(withdrawalRow.amount).toString()).toBe('25');
    expect(withdrawalRow.address).toBe(wallet);

    // Verify te_outbox_events row in PostgreSQL
    const outboxEvents = await queryOutboxEvents(pool, userId);
    expect(outboxEvents.length).toBe(1);
    expect(outboxEvents[0].event_type).toBe('withdrawalCreated');
    const payload = JSON.parse(outboxEvents[0].payload);
    expect(payload.withdrawalId).toBe(withdrawalId);
    expect(payload.amount).toBe('25');

    // Verify te_financial_audits row in PostgreSQL
    const audits = await queryFinancialAudits(pool, userId);
    expect(audits.length).toBe(1);
    expect(audits[0].event_type).toBe('WITHDRAWAL_CREATED_LOCKED');
    expect(new Decimal(audits[0].amount).toString()).toBe('25');
    expect(new Decimal(audits[0].available_before).toString()).toBe('100');
    expect(new Decimal(audits[0].available_after).toString()).toBe('75');
  });

  // =========================================================================
  // 3. PROCESSING → COMPLETED
  // =========================================================================
  it('3. Real PostgreSQL — WithdrawalWorker transitions PENDING -> PROCESSING -> COMPLETED and releases locked balance', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '100.0' });

    // Directly insert pending withdrawal into te_withdrawals and lock balance in te_balances
    const withdrawalId = `wd_${createUniqueUserId()}`;
    const now = Date.now();
    await pool.query(
      `UPDATE te_balances SET available_balance = '80.0', locked_balance = '20.0' WHERE user_id = $1 AND currency = 'TON'`,
      [userId]
    );
    await pool.query(
      `INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, funds_released, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        withdrawalId,
        `op_${withdrawalId}`,
        userId,
        '20.0',
        'TON',
        wallet,
        'PENDING',
        false,
        now,
        now,
      ]
    );

    // Mock successful TON Adapter
    const mockTonAdapter = {
      sendTon: vi.fn().mockResolvedValue({
        success: true,
        txHash: 'tx_real_postgres_hash_123456',
      }),
    };

    const worker = new WithdrawalWorker(pool, {
      adapter: mockTonAdapter as any,
      workerId: 'real_worker_1',
      batchSize: 5,
    });

    const processed = await worker.processCycle();
    expect(processed).toBe(1);

    // Assert real state in PostgreSQL te_withdrawals table
    const wRow = await queryWithdrawal(pool, withdrawalId);
    expect(wRow.status).toBe('COMPLETED');
    expect(wRow.tx_hash).toBe('tx_real_postgres_hash_123456');
    expect(wRow.funds_released).toBe(false);

    // Assert locked balance was reduced to 0 in te_balances
    const balance = await queryBalance(pool, userId, 'TON');
    expect(balance!.available_balance.toString()).toBe('80');
    expect(balance!.locked_balance.toString()).toBe('0');
  });

  // =========================================================================
  // 4. PROCESSING → FAILED & 5. LOCKED BALANCE REFUND
  // =========================================================================
  it('4 & 5. Real PostgreSQL — Failed TON transfer transitions status to FAILED and refunds locked_balance back to available_balance', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '100.0' });

    const withdrawalId = `wd_${createUniqueUserId()}`;
    const now = Date.now();
    await pool.query(
      `UPDATE te_balances SET available_balance = '85.0', locked_balance = '15.0' WHERE user_id = $1 AND currency = 'TON'`,
      [userId]
    );
    await pool.query(
      `INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, attempts, funds_released, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        withdrawalId,
        `op_${withdrawalId}`,
        userId,
        '15.0',
        'TON',
        wallet,
        'PENDING',
        1,
        false,
        now,
        now,
      ]
    );

    // Mock failing TON Adapter
    const mockFailingTonAdapter = {
      sendTon: vi.fn().mockResolvedValue({
        success: false,
        error: 'TON Node network timeout',
      }),
    };

    const worker = new WithdrawalWorker(pool, {
      adapter: mockFailingTonAdapter as any,
      workerId: 'real_worker_failing',
      maxAttempts: 1, // Max attempts reached -> transitions to FAILED
    });

    await worker.processCycle();

    // Verify te_withdrawals status in PostgreSQL is FAILED
    const wRow = await queryWithdrawal(pool, withdrawalId);
    expect(wRow.status).toBe('FAILED');
    expect(wRow.failure_reason).toContain('TON Node network timeout');
    expect(wRow.funds_released).toBe(true);

    // Verify te_balances in PostgreSQL: locked_balance refunded back to available_balance (85 + 15 = 100)
    const balance = await queryBalance(pool, userId, 'TON');
    expect(balance!.available_balance.toString()).toBe('100');
    expect(balance!.locked_balance.toString()).toBe('0');
  });

  // =========================================================================
  // 6. REPEATED FAILED & RETRY STATE RESTRICTIONS
  // =========================================================================
  it('6. Real PostgreSQL — Repeated worker cycles on FAILED record do not double refund, and retry transitions FAILED -> RETRYING', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '100.0' });
    mockTelegramAuth(userId);

    const withdrawalId = `wd_${createUniqueUserId()}`;
    const now = Date.now();
    await pool.query(
      `INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, funds_released, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [withdrawalId, `op_${withdrawalId}`, userId, '10.0', 'TON', wallet, 'FAILED', true, now, now]
    );

    const mockAdapter = { sendTon: vi.fn() };
    const worker = new WithdrawalWorker(pool, { adapter: mockAdapter as any });

    // Run worker again on FAILED record
    await worker.processCycle();

    // Verify balances did not double refund
    const balance = await queryBalance(pool, userId, 'TON');
    expect(balance!.available_balance.toString()).toBe('100');
    expect(balance!.locked_balance.toString()).toBe('0');
    expect(mockAdapter.sendTon).not.toHaveBeenCalled();

    // Test POST /api/withdraw/:id/retry
    const retryRes = await supertest(app)
      .post(`/api/withdraw/${withdrawalId}/retry`)
      .send({ initData: 'valid_init_data' });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.success).toBe(true);

    // Check DB status changed to RETRYING / PENDING
    const wRow = await queryWithdrawal(pool, withdrawalId);
    expect(['RETRYING', 'PENDING']).toContain(wRow.status);
  });

  // =========================================================================
  // 7. PARALLEL WITHDRAWALS (SAME USER CONCURRENCY)
  // =========================================================================
  it('7. Real PostgreSQL — Parallel withdrawals using two real PostgreSQL client connections prevent double spending via FOR UPDATE row locking', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '30.0' }); // User has 30.0 TON available

    // Create two independent real PostgreSQL clients to test real row locks
    const client1: Client = await createSeparateClient();
    const client2: Client = await createSeparateClient();

    try {
      // Simulate two concurrent withdrawal transactions trying to withdraw 20.0 TON each
      const withdrawalId1 = `wd_${createUniqueUserId()}`;
      const withdrawalId2 = `wd_${createUniqueUserId()}`;

      let client1Success = false;
      let client2Success = false;

      // Execute transaction 1
      const tx1 = async () => {
        try {
          await client1.query('BEGIN');
          const balRes = await client1.query(
            'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
            [userId, 'TON']
          );
          const avail = new Decimal(balRes.rows[0].available_balance);
          if (avail.greaterThanOrEqualTo('20.0')) {
            await client1.query(
              'UPDATE te_balances SET available_balance = available_balance - 20.0, locked_balance = locked_balance + 20.0 WHERE user_id = $1 AND currency = $2',
              [userId, 'TON']
            );
            await client1.query(
              'INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
              [
                withdrawalId1,
                `op_${withdrawalId1}`,
                userId,
                '20.0',
                'TON',
                wallet,
                'PENDING',
                Date.now(),
                Date.now(),
              ]
            );
            await client1.query('COMMIT');
            client1Success = true;
          } else {
            await client1.query('ROLLBACK');
          }
        } catch (e) {
          await client1.query('ROLLBACK').catch(() => {});
        }
      };

      // Execute transaction 2 concurrently
      const tx2 = async () => {
        try {
          await client2.query('BEGIN');
          const balRes = await client2.query(
            'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
            [userId, 'TON']
          );
          const avail = new Decimal(balRes.rows[0].available_balance);
          if (avail.greaterThanOrEqualTo('20.0')) {
            await client2.query(
              'UPDATE te_balances SET available_balance = available_balance - 20.0, locked_balance = locked_balance + 20.0 WHERE user_id = $1 AND currency = $2',
              [userId, 'TON']
            );
            await client2.query(
              'INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
              [
                withdrawalId2,
                `op_${withdrawalId2}`,
                userId,
                '20.0',
                'TON',
                wallet,
                'PENDING',
                Date.now(),
                Date.now(),
              ]
            );
            await client2.query('COMMIT');
            client2Success = true;
          } else {
            await client2.query('ROLLBACK');
          }
        } catch (e) {
          await client2.query('ROLLBACK').catch(() => {});
        }
      };

      await Promise.all([tx1(), tx2()]);

      // Exactly ONE transaction must succeed because 30 TON < 20 TON + 20 TON
      expect(client1Success !== client2Success).toBe(true);

      // Verify real PostgreSQL database state
      const balance = await queryBalance(pool, userId, 'TON');
      expect(balance!.available_balance.toString()).toBe('10'); // 30 - 20 = 10
      expect(balance!.locked_balance.toString()).toBe('20');

      const withdrawals = await pool.query('SELECT * FROM te_withdrawals WHERE user_id = $1', [
        userId,
      ]);
      expect(withdrawals.rows.length).toBe(1);
    } finally {
      await client1.end().catch(() => {});
      await client2.end().catch(() => {});
    }
  });

  // =========================================================================
  // 8. TWO WORKER INSTANCES CONCURRENCY
  // =========================================================================
  it('8. Real PostgreSQL — Two independent worker instances polling withdrawals concurrently do not double-process withdrawals', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '100.0' });

    // Insert 2 pending withdrawals into real PostgreSQL database
    const wId1 = `wd_${createUniqueUserId('concurrent1')}`;
    const wId2 = `wd_${createUniqueUserId('concurrent2')}`;
    const now = Date.now();

    await pool.query(
      `INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9), ($10, $11, $3, $12, $5, $6, $7, $8, $9)`,
      [
        wId1,
        `op_${wId1}`,
        userId,
        '10.0',
        'TON',
        wallet,
        'PENDING',
        now,
        now,
        wId2,
        `op_${wId2}`,
        '15.0',
      ]
    );

    let sendCount = 0;
    const mockTonAdapter = {
      sendTon: vi.fn().mockImplementation(async () => {
        sendCount++;
        return { success: true, txHash: `tx_hash_worker_${sendCount}` };
      }),
    };

    const worker1 = new WithdrawalWorker(pool, {
      adapter: mockTonAdapter as any,
      workerId: 'worker_A',
    });
    const worker2 = new WithdrawalWorker(pool, {
      adapter: mockTonAdapter as any,
      workerId: 'worker_B',
    });

    // Run both workers simultaneously on real PostgreSQL database
    await Promise.all([worker1.processCycle(), worker2.processCycle()]);

    // Send TON must be called exactly 2 times in total (once for wId1, once for wId2)
    expect(sendCount).toBe(2);

    // Verify both withdrawals in PostgreSQL are COMPLETED
    const row1 = await queryWithdrawal(pool, wId1);
    const row2 = await queryWithdrawal(pool, wId2);

    expect(row1.status).toBe('COMPLETED');
    expect(row2.status).toBe('COMPLETED');
  });

  // =========================================================================
  // 9. ROLLBACK MID-TRANSACTION
  // =========================================================================
  it('9. Real PostgreSQL — Transaction error or explicit ROLLBACK mid-transaction leaves database completely clean', async () => {
    const wallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
    const userId = await spawnTestUser(wallet, { TON: '50.0' });

    const client = await pool.connect();
    const wId = `wd_${createUniqueUserId('rollback')}`;

    try {
      await client.query('BEGIN');

      // Deduct balance
      await client.query(
        'UPDATE te_balances SET available_balance = available_balance - 20.0, locked_balance = locked_balance + 20.0 WHERE user_id = $1 AND currency = $2',
        [userId, 'TON']
      );

      // Insert withdrawal
      await client.query(
        'INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [wId, `op_${wId}`, userId, '20.0', 'TON', wallet, 'PENDING', Date.now(), Date.now()]
      );

      // Simulate unexpected mid-transaction failure -> ROLLBACK
      throw new Error('Simulated mid-transaction system crash!');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Verify real PostgreSQL state: balances remained 50.0 available, 0 locked
    const balance = await queryBalance(pool, userId, 'TON');
    expect(balance!.available_balance.toString()).toBe('50');
    expect(balance!.locked_balance.toString()).toBe('0');

    // Verify zero withdrawal rows persisted
    const wRow = await queryWithdrawal(pool, wId);
    expect(wRow).toBeNull();
  });

  // =========================================================================
  // 10 & 11. DUPLICATE PAYMENT & UNIQUE CHARGE ID / IDEMPOTENCY KEY
  // =========================================================================
  it('10 & 11. Real PostgreSQL — Duplicate payment with same telegram_payment_charge_id hits unique constraint and credits STARS balance exactly once', async () => {
    const userId = await spawnTestUser('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N');
    const invoiceId = `inv_${createUniqueUserId('stars')}`;
    const chargeId = `ch_telegram_stars_${createUniqueUserId()}`;
    const now = Date.now();

    // Create pending invoice in real PostgreSQL te_invoices table
    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        invoiceId,
        userId,
        500,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 500 }),
        `nonce_${invoiceId}`,
        'PENDING',
        now,
      ]
    );

    const payment = {
      currency: 'XTR',
      total_amount: 500,
      invoice_payload: JSON.stringify({ invoiceId, userId, stars: 500 }),
      telegram_payment_charge_id: chargeId,
    };

    // First Payment execution
    const res1 = await processSuccessfulStarsPayment(payment as any, userId);
    expect(res1.success).toBe(true);
    expect(res1.duplicate).toBe(false);

    // Verify balance credited in PostgreSQL te_balances table
    const starsBalance1 = await queryBalance(pool, userId, 'STARS');
    expect(starsBalance1!.available_balance.toString()).toBe('500');

    // Verify te_invoices updated to PAID
    const inv1 = await queryInvoiceById(pool, invoiceId);
    expect(inv1.status).toBe('PAID');

    // Verify te_payments row created
    const pm1 = await queryPaymentByChargeId(pool, chargeId);
    expect(pm1).not.toBeNull();
    expect(pm1.user_id).toBe(userId);

    // Second Payment execution (duplicate webhook with exact same chargeId)
    const res2 = await processSuccessfulStarsPayment(payment as any, userId);
    expect(res2.success).toBe(true);
    expect(res2.duplicate).toBe(true);

    // Assert STARS balance was NOT credited twice (still 500)
    const starsBalance2 = await queryBalance(pool, userId, 'STARS');
    expect(starsBalance2!.available_balance.toString()).toBe('500');

    // Assert te_payments table contains exactly 1 row for chargeId
    const payments = await queryPayments(pool, userId);
    expect(payments.length).toBe(1);
  });

  // =========================================================================
  // 12. DATABASE FAILURE MID-PAYMENT
  // =========================================================================
  it('12. Real PostgreSQL — Database failure during payment processing rolls back cleanly without partial credit', async () => {
    const userId = await spawnTestUser('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N');
    const invoiceId = `inv_${createUniqueUserId('fail')}`;
    const chargeId = `ch_fail_${createUniqueUserId()}`;

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        invoiceId,
        userId,
        1000,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 1000 }),
        `nonce_${invoiceId}`,
        'PENDING',
        Date.now(),
      ]
    );

    // Induce query error on client during payment to simulate database disconnection during payment
    const realConnect = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      const realRelease = client.release.bind(client);

      client.query = (async (sql: any, params: any) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO te_payments')) {
          throw new Error('Database connection lost during te_payments insert');
        }
        return realQuery(sql, params);
      }) as any;

      client.release = ((destroy?: boolean | Error) => {
        client.query = realQuery;
        client.release = realRelease;
        return realRelease(true); // Pass true to discard broken client from pool
      }) as any;

      return client;
    });

    const payment = {
      currency: 'XTR',
      total_amount: 1000,
      invoice_payload: JSON.stringify({ invoiceId, userId, stars: 1000 }),
      telegram_payment_charge_id: chargeId,
    };

    const res = await processSuccessfulStarsPayment(payment as any, userId);
    spy.mockRestore();
    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(pool);

    expect(res.success).toBe(false);
    expect(res.code).toBe('DB_ERROR');

    // Verify invoice remains PENDING in real PostgreSQL and zero STARS credited
    const inv = await queryInvoiceById(pool, invoiceId);
    expect(inv.status).toBe('PENDING');

    const starsBalance = await queryBalance(pool, userId, 'STARS');
    expect(starsBalance).toBeNull();
  });

  // =========================================================================
  // 13. ABSENCE OF NEGATIVE BALANCE
  // =========================================================================
  it('13. Real PostgreSQL — Database CHECK constraint (available_balance >= 0) explicitly rejects any query attempting negative balance', async () => {
    const userId = await spawnTestUser('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N', {
      TON: '10.0',
    });

    // Attempt direct SQL update to force negative available_balance
    let errorCaught: any = null;
    try {
      await pool.query(
        'UPDATE te_balances SET available_balance = -15.0 WHERE user_id = $1 AND currency = $2',
        [userId, 'TON']
      );
    } catch (e: any) {
      errorCaught = e;
    }

    // PostgreSQL code '23514' is check_violation
    expect(errorCaught).not.toBeNull();
    expect(errorCaught?.code).toBe('23514');

    // Query balance to confirm it remained 10.0
    const balance = await queryBalance(pool, userId, 'TON');
    expect(balance!.available_balance.toString()).toBe('10');
  });
});
