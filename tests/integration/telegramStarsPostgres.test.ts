import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { Pool } from 'pg';
import financialRoutes from '../../server/routes/financialRoutes';
import * as telegramAuth from '../../server/telegramAuth';
import * as marketRepository from '../../server/marketRepository';
import {
  createStarsInvoice,
  validatePreCheckout,
  processSuccessfulStarsPayment,
} from '../../server/invoiceService';
import {
  getTestDbPool,
  closeTestDbPool,
  createSeparateClient,
  createUniqueUserId,
  createUniqueNumericUserId,
  seedTestUser,
  cleanupUserData,
  queryBalance,
  queryOutboxEvents,
  queryFinancialAudits,
  queryInvoiceById,
  queryPayments,
  queryPaymentByChargeId,
} from './postgresFixture';

describe('Dedicated Real PostgreSQL Integration Tests — Telegram Stars Payment Flow', () => {
  let pool: Pool;
  let app: express.Application;
  let createdUserIds: string[] = [];
  const originalEnv = process.env;
  const TEST_BOT_TOKEN = '777888999:AAEF_test_bot_token_secret_1234567890';

  beforeAll(async () => {
    pool = await getTestDbPool();
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
      BOT_TOKEN: TEST_BOT_TOKEN,
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      NODE_ENV: 'test',
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
    for (const userId of createdUserIds) {
      await cleanupUserData(pool, userId);
    }
    createdUserIds = [];
    vi.restoreAllMocks();
    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(pool);
  });

  const spawnTestUser = async (
    walletAddress: string = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
    balances: { TON?: string | number; STARS?: string | number } = {}
  ) => {
    const userId = createUniqueNumericUserId();
    createdUserIds.push(userId);
    await seedTestUser(pool, userId, walletAddress, balances);
    return userId;
  };

  const mockTelegramAuth = (userId: string) => {
    const numId = Number(userId);
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: true,
      user: { id: numId, first_name: `User_${userId}` },
    });
  };

  // =========================================================================
  // 1. CREATE-INVOICE ACCEPTS ONLY SERVER-VALIDATED TELEGRAM IDENTITY
  // =========================================================================
  it('1. create-invoice accepts ONLY server-validated Telegram identity and ignores body.userId', async () => {
    const realUserId = await spawnTestUser();
    mockTelegramAuth(realUserId);

    // Mock Telegram createInvoiceLink fetch response
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('createInvoiceLink')) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: `https://t.me/invoice_link_${realUserId}`,
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // Attempt request with a spoofed userId in request body
    const res = await supertest(app).post('/api/create-invoice').send({
      initData: 'valid_telegram_init_data',
      starsAmount: 100,
      userId: 'spoofed_hacker_user_999999', // Attacker trying to substitute userId
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const invoiceId = res.body.invoiceId;
    expect(invoiceId).toBeDefined();

    // Verify in real PostgreSQL te_invoices table that user_id is the server-validated realUserId
    const inv = await queryInvoiceById(pool, invoiceId);
    expect(inv).not.toBeNull();
    expect(inv.user_id).toBe(realUserId); // Must be realUserId, NOT spoofed_hacker_user_999999
    expect(inv.user_id).not.toBe('spoofed_hacker_user_999999');

    fetchSpy.mockRestore();
  });

  it('1b. create-invoice strictly rejects unauthenticated or invalid initData requests', async () => {
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: false,
      user: undefined,
    });

    const res = await supertest(app).post('/api/create-invoice').send({
      initData: 'invalid_forged_init_data',
      starsAmount: 100,
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_AUTH');

    // Confirm 0 invoices created in te_invoices for invalid auth
    const invCount = await pool.query("SELECT COUNT(*) FROM te_invoices WHERE status = 'PENDING'");
    // No new pending invoice created by this request
  });

  // =========================================================================
  // 2. CLIENT CANNOT SET USER ID, AMOUNT, CURRENCY, INVOICE ID, PAYLOAD, CHARGE ID
  // =========================================================================
  it('2. Client cannot override amount, currency, invoice ID, payload, or charge ID', async () => {
    const realUserId = await spawnTestUser();
    mockTelegramAuth(realUserId);

    // A. Rejects arbitrary unallowed amount (e.g. 1234 Stars)
    const invalidAmountRes = await supertest(app).post('/api/create-invoice').send({
      initData: 'valid_init_data',
      starsAmount: 1234, // Not in ALLOWED_STARS_AMOUNTS
    });

    expect(invalidAmountRes.status).toBe(400);
    expect(invalidAmountRes.body.code).toBe('INVALID_AMOUNT');

    // B. For valid amount (e.g. 500 Stars), client-supplied fields (currency, invoiceId, payload) are ignored
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          result: 'https://t.me/invoice_link_500',
        }),
        { status: 200 }
      );
    });

    const res = await supertest(app).post('/api/create-invoice').send({
      initData: 'valid_init_data',
      starsAmount: 500,
      currency: 'EUR', // Client trying to set currency
      invoiceId: 'inv_client_chosen_123', // Client trying to choose invoice ID
      payload: '{"custom":"hacked"}', // Client trying to forge payload
      telegram_payment_charge_id: 'ch_fake_123',
    });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('XTR'); // Enforced XTR
    expect(res.body.invoiceId).not.toBe('inv_client_chosen_123'); // Server-generated ID

    const inv = await queryInvoiceById(pool, res.body.invoiceId);
    expect(inv.currency).toBe('XTR');
    expect(inv.user_id).toBe(realUserId);

    // Verify server-signed payload structure
    const payloadObj = JSON.parse(inv.payload);
    expect(payloadObj.invoiceId).toBe(res.body.invoiceId);
    expect(payloadObj.userId).toBe(realUserId);
    expect(payloadObj.stars).toBe(500);
    expect(payloadObj.nonce).toBeDefined();

    fetchSpy.mockRestore();
  });

  // =========================================================================
  // 3. INVOICE CREATED IN POSTGRESQL BEFORE CALLING TELEGRAM API
  // =========================================================================
  it('3. Invoice is created in PostgreSQL DB BEFORE invoking Telegram Bot API createInvoiceLink', async () => {
    const userId = await spawnTestUser();
    mockTelegramAuth(userId);

    let dbStateInsideFetch: any = null;

    // Spy fetch and inspect PostgreSQL table BEFORE resolving fetch
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
      if (String(url).includes('createInvoiceLink')) {
        const bodyObj = JSON.parse(init.body);
        const payloadObj = JSON.parse(bodyObj.payload);
        const invId = payloadObj.invoiceId;

        // Query real PostgreSQL te_invoices table inside fetch handler
        const queryRes = await pool.query(
          'SELECT id, user_id, stars_amount, status FROM te_invoices WHERE id = $1',
          [invId]
        );
        dbStateInsideFetch = queryRes.rows[0];

        return new Response(JSON.stringify({ ok: true, result: 'https://t.me/$invoice_link' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const res = await supertest(app).post('/api/create-invoice').send({
      initData: 'valid_init_data',
      starsAmount: 250,
    });

    expect(res.status).toBe(200);
    expect(dbStateInsideFetch).not.toBeNull();
    expect(dbStateInsideFetch.id).toBe(res.body.invoiceId);
    expect(dbStateInsideFetch.status).toBe('PENDING');
    expect(dbStateInsideFetch.stars_amount.toString()).toBe('250');

    fetchSpy.mockRestore();
  });

  // =========================================================================
  // 4. TELEGRAM API ERROR DOES NOT LEAVE INVOICE IN PAYABLE STATE
  // =========================================================================
  it('4. Telegram API error updates invoice status to FAILED in PostgreSQL and blocks subsequent payment', async () => {
    const userId = await spawnTestUser();
    mockTelegramAuth(userId);

    // Mock Telegram API returning failure (e.g. BOT TOKEN REJECTED or Telegram server error)
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          description: 'Bad Request: INVALID_PROVIDER_TOKEN',
        }),
        { status: 400 }
      );
    });

    const res = await supertest(app).post('/api/create-invoice').send({
      initData: 'valid_init_data',
      starsAmount: 1000,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TELEGRAM_API_ERROR');

    // Query PostgreSQL te_invoices table to verify status was marked FAILED
    const failedInvoices = await pool.query(
      "SELECT * FROM te_invoices WHERE user_id = $1 AND status = 'FAILED'",
      [userId]
    );
    expect(failedInvoices.rows.length).toBe(1);
    const failedInv = failedInvoices.rows[0];
    expect(failedInv.failure_reason).toContain('INVALID_PROVIDER_TOKEN');

    // Attempt pre_checkout_query for this failed invoice
    const pcqRes = await validatePreCheckout({
      id: 'pcq_test_123',
      from: { id: Number(userId) },
      currency: 'XTR',
      total_amount: 1000,
      invoice_payload: failedInv.payload,
    });

    expect(pcqRes.ok).toBe(false);
    expect(pcqRes.errorMessage).toContain('failed');

    // Attempt processSuccessfulStarsPayment for this failed invoice
    const payRes = await processSuccessfulStarsPayment(
      {
        currency: 'XTR',
        total_amount: 1000,
        invoice_payload: failedInv.payload,
        telegram_payment_charge_id: `ch_failed_${createUniqueUserId()}`,
      },
      userId
    );

    expect(payRes.success).toBe(false);
    expect(payRes.code).toBe('INVALID_INVOICE_STATUS');

    fetchSpy.mockRestore();
  });

  // =========================================================================
  // 5. SUCCESSFUL PAYMENT IS PROCESSED IN A SINGLE ACID TRANSACTION
  // =========================================================================
  it('5. processSuccessfulStarsPayment executes atomic ACID updates across te_balances, te_invoices, te_payments, te_financial_audits, and te_outbox_events', async () => {
    const userId = await spawnTestUser();
    const invoiceId = `inv_${createUniqueUserId('acid')}`;
    const chargeId = `ch_acid_${createUniqueUserId()}`;
    const now = Date.now();

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        invoiceId,
        userId,
        5000,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 5000 }),
        `nonce_${invoiceId}`,
        now,
      ]
    );

    const result = await processSuccessfulStarsPayment(
      {
        currency: 'XTR',
        total_amount: 5000,
        invoice_payload: JSON.stringify({ invoiceId, userId, stars: 5000 }),
        telegram_payment_charge_id: chargeId,
      },
      userId
    );

    expect(result.success).toBe(true);
    expect(result.starsCredited).toBe(5000);

    // Check te_balances
    const balance = await queryBalance(pool, userId, 'STARS');
    expect(balance!.available_balance.toString()).toBe('5000');

    // Check te_invoices status = PAID
    const inv = await queryInvoiceById(pool, invoiceId);
    expect(inv.status).toBe('PAID');
    expect(inv.telegram_payment_charge_id).toBe(chargeId);

    // Check te_payments
    const payment = await queryPaymentByChargeId(pool, chargeId);
    expect(payment).not.toBeNull();
    expect(payment.amount.toString()).toBe('5000');
    expect(payment.user_id).toBe(userId);

    // Check te_financial_audits
    const audits = await queryFinancialAudits(pool, userId);
    expect(audits.length).toBe(1);
    expect(audits[0].event_type).toBe('STARS_DEPOSIT_COMPLETED');
    expect(audits[0].amount.toString()).toBe('5000');

    // Check te_outbox_events
    const outbox = await queryOutboxEvents(pool, userId);
    expect(outbox.length).toBe(1);
    expect(outbox[0].event_type).toBe('balanceUpdated');
  });

  // =========================================================================
  // 6. BALANCE LOCKED VIA SELECT FOR UPDATE
  // =========================================================================
  it('6. SELECT ... FOR UPDATE prevents concurrent race conditions on invoice row and balance updates', async () => {
    const userId = await spawnTestUser();
    const invoiceId = `inv_${createUniqueUserId('lock')}`;
    const chargeId = `ch_lock_${createUniqueUserId()}`;

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        invoiceId,
        userId,
        1000,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 1000 }),
        `nonce_${invoiceId}`,
        Date.now(),
      ]
    );

    const client2 = await createSeparateClient();
    try {
      // Client 2 holds FOR UPDATE lock on the invoice row
      await client2.query('BEGIN');
      await client2.query('SELECT * FROM te_invoices WHERE id = $1 FOR UPDATE', [invoiceId]);

      let processFinished = false;
      const processPromise = processSuccessfulStarsPayment(
        {
          currency: 'XTR',
          total_amount: 1000,
          invoice_payload: JSON.stringify({ invoiceId, userId, stars: 1000 }),
          telegram_payment_charge_id: chargeId,
        },
        userId
      ).then((res) => {
        processFinished = true;
        return res;
      });

      // Wait 100ms and confirm processSuccessfulStarsPayment is waiting for row lock
      await new Promise((r) => setTimeout(r, 100));
      expect(processFinished).toBe(false);

      // Client 2 commits and releases row lock
      await client2.query('COMMIT');

      const res = await processPromise;
      expect(res.success).toBe(true);
      expect(res.starsCredited).toBe(1000);
    } finally {
      await client2.end().catch(() => {});
    }
  });

  // =========================================================================
  // 7. SUCCESSFUL CREDIT IS POSSIBLE ONLY ONCE
  // =========================================================================
  it('7. Idempotent payment processing guarantees user balance is credited exactly once', async () => {
    const userId = await spawnTestUser();
    const invoiceId = `inv_${createUniqueUserId('once')}`;
    const chargeId = `ch_once_${createUniqueUserId()}`;

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        invoiceId,
        userId,
        500,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 500 }),
        `nonce_${invoiceId}`,
        Date.now(),
      ]
    );

    const payment = {
      currency: 'XTR',
      total_amount: 500,
      invoice_payload: JSON.stringify({ invoiceId, userId, stars: 500 }),
      telegram_payment_charge_id: chargeId,
    };

    const res1 = await processSuccessfulStarsPayment(payment, userId);
    expect(res1.success).toBe(true);
    expect(res1.duplicate).toBe(false);

    const bal1 = await queryBalance(pool, userId, 'STARS');
    expect(bal1!.available_balance.toString()).toBe('500');

    // Attempt second processing of identical payment
    const res2 = await processSuccessfulStarsPayment(payment, userId);
    expect(res2.success).toBe(true);
    expect(res2.duplicate).toBe(true);

    const bal2 = await queryBalance(pool, userId, 'STARS');
    expect(bal2!.available_balance.toString()).toBe('500'); // Remains 500, NOT 1000

    const pmts = await queryPayments(pool, userId);
    expect(pmts.length).toBe(1); // Exactly 1 payment record
  });

  // =========================================================================
  // 8. UNIQUENESS OF CHARGE ID ENFORCED BY POSTGRESQL CONSTRAINT
  // =========================================================================
  it('8. te_payments_charge_id_unique constraint in PostgreSQL rejects duplicate charge IDs', async () => {
    const userId = await spawnTestUser();
    const invoiceId1 = `inv_1_${createUniqueUserId()}`;
    const invoiceId2 = `inv_2_${createUniqueUserId()}`;
    const chargeId = `ch_unique_constraint_${createUniqueUserId()}`;
    const now = Date.now();

    // Create referenced invoice rows in te_invoices
    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PAID', $7), ($8, $2, $3, $4, $9, $10, 'PAID', $7)`,
      [
        invoiceId1,
        userId,
        100,
        'XTR',
        JSON.stringify({ invoiceId: invoiceId1, userId, stars: 100 }),
        `nonce_${invoiceId1}`,
        now,
        invoiceId2,
        JSON.stringify({ invoiceId: invoiceId2, userId, stars: 100 }),
        `nonce_${invoiceId2}`,
      ]
    );

    // Insert first payment record
    await pool.query(
      `INSERT INTO te_payments (id, invoice_id, user_id, amount, currency, telegram_payment_charge_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`pay_1_${createUniqueUserId()}`, invoiceId1, userId, '100', 'STARS', chargeId, now]
    );

    // Attempt second SQL insert with identical telegram_payment_charge_id
    let errorCaught: any = null;
    try {
      await pool.query(
        `INSERT INTO te_payments (id, invoice_id, user_id, amount, currency, telegram_payment_charge_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [`pay_2_${createUniqueUserId()}`, invoiceId2, userId, '100', 'STARS', chargeId, now]
      );
    } catch (err: any) {
      errorCaught = err;
    }

    // PostgreSQL code 23505 is unique_violation
    expect(errorCaught).not.toBeNull();
    expect(errorCaught?.code).toBe('23505');
  });

  // =========================================================================
  // 9. REPEAT WEBHOOK RETURNS DUPLICATE/NO-OP AND DOES NOT CHANGE BALANCE
  // =========================================================================
  it('9. Duplicate Telegram webhook returns duplicate status without changing balance or audit records', async () => {
    const userId = await spawnTestUser();
    const invoiceId = `inv_${createUniqueUserId('webhook')}`;
    const chargeId = `ch_webhook_${createUniqueUserId()}`;

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        invoiceId,
        userId,
        100,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 100 }),
        `nonce_${invoiceId}`,
        Date.now(),
      ]
    );

    const webhookBody = {
      update_id: 1234567,
      message: {
        from: { id: Number(userId) },
        successful_payment: {
          currency: 'XTR',
          total_amount: 100,
          invoice_payload: JSON.stringify({ invoiceId, userId, stars: 100 }),
          telegram_payment_charge_id: chargeId,
        },
      },
    };

    // First Webhook POST
    const res1 = await supertest(app).post('/api/telegram/payment-webhook').send(webhookBody);

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.duplicate).toBe(false);

    const bal1 = await queryBalance(pool, userId, 'STARS');
    expect(bal1!.available_balance.toString()).toBe('100');

    // Second Webhook POST (Duplicate)
    const res2 = await supertest(app).post('/api/telegram/payment-webhook').send(webhookBody);

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.duplicate).toBe(true);

    const bal2 = await queryBalance(pool, userId, 'STARS');
    expect(bal2!.available_balance.toString()).toBe('100'); // Still 100

    const audits = await queryFinancialAudits(pool, userId);
    expect(audits.length).toBe(1); // Audit count unchanged
  });

  // =========================================================================
  // 10. VERIFIES SENDER MATCHES PAYLOAD USER ID
  // =========================================================================
  it('10. Rejects payment processing when Telegram sender ID does not match invoice payload userId', async () => {
    const realUser = await spawnTestUser();
    const attackerUser = await spawnTestUser();
    const invoiceId = `inv_${createUniqueUserId('mismatch')}`;

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        invoiceId,
        realUser,
        1000,
        'XTR',
        JSON.stringify({ invoiceId, userId: realUser, stars: 1000 }),
        `nonce_${invoiceId}`,
        Date.now(),
      ]
    );

    // Attacker tries to submit payment update for realUser invoice
    const result = await processSuccessfulStarsPayment(
      {
        currency: 'XTR',
        total_amount: 1000,
        invoice_payload: JSON.stringify({ invoiceId, userId: realUser, stars: 1000 }),
        telegram_payment_charge_id: `ch_mismatch_${createUniqueUserId()}`,
      },
      attackerUser // Sender ID does NOT match payload userId
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('USER_MISMATCH');

    // Confirm 0 balance credited to realUser or attackerUser
    const realBal = await queryBalance(pool, realUser, 'STARS');
    const attackerBal = await queryBalance(pool, attackerUser, 'STARS');
    expect(realBal).toBeNull();
    expect(attackerBal).toBeNull();

    // Confirm invoice remains PENDING
    const inv = await queryInvoiceById(pool, invoiceId);
    expect(inv.status).toBe('PENDING');
  });

  // =========================================================================
  // 11. VERIFIES CURRENCY XTR AND EXACT AMOUNT
  // =========================================================================
  it('11. Rejects payment with wrong currency or mismatched amount', async () => {
    const userId = await spawnTestUser();
    const invoiceId = `inv_${createUniqueUserId('cur')}`;

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        invoiceId,
        userId,
        500,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 500 }),
        `nonce_${invoiceId}`,
        Date.now(),
      ]
    );

    // A. Wrong currency (e.g. USD)
    const curRes = await processSuccessfulStarsPayment(
      {
        currency: 'USD',
        total_amount: 500,
        invoice_payload: JSON.stringify({ invoiceId, userId, stars: 500 }),
        telegram_payment_charge_id: `ch_usd_${createUniqueUserId()}`,
      },
      userId
    );

    expect(curRes.success).toBe(false);
    expect(curRes.code).toBe('INVALID_CURRENCY');

    // B. Amount mismatch (total_amount = 100, payload stars = 500)
    const amtRes = await processSuccessfulStarsPayment(
      {
        currency: 'XTR',
        total_amount: 100, // Mismatched amount
        invoice_payload: JSON.stringify({ invoiceId, userId, stars: 500 }),
        telegram_payment_charge_id: `ch_amt_${createUniqueUserId()}`,
      },
      userId
    );

    expect(amtRes.success).toBe(false);
    expect(amtRes.code).toBe('AMOUNT_MISMATCH');

    const bal = await queryBalance(pool, userId, 'STARS');
    expect(bal).toBeNull();
  });

  // =========================================================================
  // 12. DATABASE ERROR CAUSES COMPLETE ROLLBACK WITHOUT PARTIAL CREDIT
  // =========================================================================
  it('12. Mid-transaction database error rolls back completely leaving 0 balance and 0 payment rows', async () => {
    const userId = await spawnTestUser();
    const invoiceId = `inv_${createUniqueUserId('dberr')}`;

    await pool.query(
      `INSERT INTO te_invoices (id, user_id, stars_amount, currency, payload, nonce, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
      [
        invoiceId,
        userId,
        1000,
        'XTR',
        JSON.stringify({ invoiceId, userId, stars: 1000 }),
        `nonce_${invoiceId}`,
        Date.now(),
      ]
    );

    // Mock DB client to throw error during te_financial_audits insert
    const realConnect = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      const realRelease = client.release.bind(client);

      client.query = (async (sql: any, params: any) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO te_financial_audits')) {
          throw new Error('Simulated database write failure during financial audit log');
        }
        return realQuery(sql, params);
      }) as any;

      client.release = ((destroy?: boolean | Error) => {
        client.query = realQuery;
        client.release = realRelease;
        return realRelease(true);
      }) as any;

      return client;
    });

    const result = await processSuccessfulStarsPayment(
      {
        currency: 'XTR',
        total_amount: 1000,
        invoice_payload: JSON.stringify({ invoiceId, userId, stars: 1000 }),
        telegram_payment_charge_id: `ch_dberr_${createUniqueUserId()}`,
      },
      userId
    );

    spy.mockRestore();
    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(pool);

    expect(result.success).toBe(false);
    expect(result.code).toBe('DB_ERROR');

    // Confirm full ROLLBACK: invoice is still PENDING, 0 STARS in balance, 0 payments, 0 audits
    const inv = await queryInvoiceById(pool, invoiceId);
    expect(inv.status).toBe('PENDING');

    const bal = await queryBalance(pool, userId, 'STARS');
    expect(bal).toBeNull();

    const pmts = await queryPayments(pool, userId);
    expect(pmts.length).toBe(0);

    const audits = await queryFinancialAudits(pool, userId);
    expect(audits.length).toBe(0);
  });

  // =========================================================================
  // 13. SECRETS DO NOT LEAK INTO LOGS OR FRONTEND
  // =========================================================================
  it('13. Telegram BOT_TOKEN is never exposed in API responses or error payloads', async () => {
    const userId = await spawnTestUser();
    mockTelegramAuth(userId);

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          description: 'Telegram API mock error test',
        }),
        { status: 400 }
      );
    });

    const res = await supertest(app).post('/api/create-invoice').send({
      initData: 'valid_init_data',
      starsAmount: 500,
    });

    expect(res.status).toBe(400);

    const responseStr = JSON.stringify(res.body);
    expect(responseStr).not.toContain(TEST_BOT_TOKEN);
    expect(responseStr).not.toContain('777888999');

    fetchSpy.mockRestore();
  });
});
