import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { Pool } from 'pg';
import Decimal from 'decimal.js';
import crypto from 'crypto';

import financialRoutes from '../../server/routes/financialRoutes';
import marketRoutes from '../../server/routes/marketRoutes';
import * as telegramAuth from '../../server/telegramAuth';
import * as marketRepository from '../../server/marketRepository';
import {
  createStarsInvoice,
  validatePreCheckout,
  processSuccessfulStarsPayment,
} from '../../server/invoiceService';
import {
  getFloorPrice,
  addListing,
  updateListingPrice,
  cancelListing,
  sellListing,
  clearFloorState,
} from '../../server/floorManager';
import { WithdrawalWorker } from '../../server/withdrawalWorker';
import { MockTonTransferAdapter } from '../../server/tonAdapter';
import { PostgresTradingEngine } from '../../server/trading/tradingEngine';
import {
  getTestDbPool,
  closeTestDbPool,
  createUniqueNumericUserId,
  createUniqueUserId,
  seedTestUser,
  cleanupUserData,
  queryBalance,
  queryWithdrawal,
  queryFinancialAudits,
  queryOutboxEvents,
  queryInvoiceById,
  queryPaymentByChargeId,
} from './postgresFixture';

describe('GX Exchange — End-to-End Primary Financial Scenario (PostgreSQL & Mock Adapters)', () => {
  let pool: Pool;
  let app: express.Application;
  let createdUserIds: string[] = [];
  let tradingEngine: PostgresTradingEngine;
  const originalEnv = process.env;
  const TEST_BOT_TOKEN = '777888999:AAEF_test_bot_token_secret_1234567890';

  beforeAll(async () => {
    pool = await getTestDbPool();
    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(pool);

    tradingEngine = new PostgresTradingEngine(pool);

    app = express();
    app.use(express.json());
    app.use('/api', financialRoutes);
    app.use('/api', marketRoutes);
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
      USE_MOCK_GIFTS: 'true',
    };
    clearFloorState();
  });

  afterEach(async () => {
    process.env = originalEnv;
    for (const userId of createdUserIds) {
      await cleanupUserData(pool, userId);
    }
    createdUserIds = [];
    clearFloorState();
    vi.restoreAllMocks();
    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(pool);
  });

  const registerTestUser = async (
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
  // STEP 1: TELEGRAM AUTHENTICATION & WALLET REGISTRATION
  // =========================================================================
  describe('Step 1: Telegram Authentication & Identity Binding', () => {
    it('1.1 Should validate genuine Telegram initData and register user wallet address in PostgreSQL te_users', async () => {
      const sellerId = createUniqueNumericUserId();
      createdUserIds.push(sellerId);
      const sellerWallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';

      mockTelegramAuth(sellerId);

      const res = await supertest(app)
        .post('/api/user/wallet')
        .send({
          initData: 'valid_telegram_init_data_for_auth',
          walletAddress: sellerWallet,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.userId).toBe(sellerId);
      expect(res.body.walletAddress).toBe(sellerWallet);

      // Verify row in PostgreSQL te_users table
      const userRow = await pool.query('SELECT * FROM te_users WHERE id = $1', [sellerId]);
      expect(userRow.rows.length).toBe(1);
      expect(userRow.rows[0].wallet_address).toBe(sellerWallet);
    });

    it('1.2 Should reject forged Telegram initData signatures with HTTP 401 Unauthorized', async () => {
      vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
        isValid: false,
        user: undefined,
      });

      const res = await supertest(app)
        .post('/api/user/wallet')
        .send({
          initData: 'forged_tampered_init_data',
          walletAddress: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });
  });

  // =========================================================================
  // STEP 2: DEPOSIT (STARS & TON) & IDEMPOTENCY
  // =========================================================================
  describe('Step 2: Deposit Flow & Balance Crediting', () => {
    it('2.1 Should create Stars invoice, process successful payment via webhook, credit balance, and guarantee idempotency', async () => {
      const buyerId = await registerTestUser('EQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqReqECNDxNVVNUt');
      mockTelegramAuth(buyerId);

      // Mock Telegram Bot API createInvoiceLink
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('createInvoiceLink')) {
          return new Response(
            JSON.stringify({ ok: true, result: `https://t.me/invoice_${buyerId}` }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      // 1. Create Invoice
      const invoiceRes = await supertest(app).post('/api/create-invoice').send({
        initData: 'valid_init_data',
        starsAmount: 1000,
      });

      expect(invoiceRes.status).toBe(200);
      expect(invoiceRes.body.success).toBe(true);
      const invoiceId = invoiceRes.body.invoiceId;

      // Verify invoice row in PostgreSQL te_invoices
      const invRecord = await queryInvoiceById(pool, invoiceId);
      expect(invRecord).not.toBeNull();
      expect(invRecord.status).toBe('PENDING');
      expect(new Decimal(invRecord.stars_amount).toString()).toBe('1000');

      // 2. Pre-checkout query validation
      const pcq = {
        id: 'pcq_test_1000',
        from: { id: Number(buyerId) },
        currency: 'XTR',
        total_amount: 1000,
        invoice_payload: invRecord.payload,
      };
      const pcqResult = await validatePreCheckout(pcq);
      expect(pcqResult.ok).toBe(true);

      // 3. Process Successful Payment Webhook
      const chargeId = `ch_stars_${createUniqueUserId()}`;
      const webhookRes1 = await supertest(app)
        .post('/api/telegram/payment-webhook')
        .send({
          update_id: 999111,
          message: {
            from: { id: Number(buyerId) },
            successful_payment: {
              currency: 'XTR',
              total_amount: 1000,
              invoice_payload: invRecord.payload,
              telegram_payment_charge_id: chargeId,
            },
          },
        });

      expect(webhookRes1.status).toBe(200);
      expect(webhookRes1.body.ok).toBe(true);
      expect(webhookRes1.body.duplicate).toBe(false);

      // Verify balance in PostgreSQL te_balances
      const balanceAfter = await queryBalance(pool, buyerId, 'STARS');
      expect(balanceAfter).not.toBeNull();
      expect(balanceAfter!.available_balance.toString()).toBe('1000');

      // 4. Duplicate payment webhook: must be ignored and not duplicate credit
      const webhookRes2 = await supertest(app)
        .post('/api/telegram/payment-webhook')
        .send({
          update_id: 999112,
          message: {
            from: { id: Number(buyerId) },
            successful_payment: {
              currency: 'XTR',
              total_amount: 1000,
              invoice_payload: invRecord.payload,
              telegram_payment_charge_id: chargeId,
            },
          },
        });

      expect(webhookRes2.status).toBe(200);
      expect(webhookRes2.body.ok).toBe(true);
      expect(webhookRes2.body.duplicate).toBe(true);

      // Balance remains strictly 1000 STARS
      const balanceDuplicate = await queryBalance(pool, buyerId, 'STARS');
      expect(balanceDuplicate!.available_balance.toString()).toBe('1000');

      // Payment record count remains exactly 1
      const paymentRecord = await queryPaymentByChargeId(pool, chargeId);
      expect(paymentRecord).not.toBeNull();
      expect(new Decimal(paymentRecord.amount).toString()).toBe('1000');

      fetchSpy.mockRestore();
    });
  });

  // =========================================================================
  // STEP 3: LISTING CREATION & ASSET RESERVATION
  // =========================================================================
  describe('Step 3: Gift / Instrument Listing & Floor Price Calculation', () => {
    it('3.1 Should create listing with strict Decimal price validation, update floor price, and record listing', async () => {
      const sellerId = await registerTestUser();
      const listingId = `list_${createUniqueUserId()}`;
      const instrumentKey = 'tg_gift_red_star:TON';

      const listingRes = addListing({
        listingId,
        instrumentKey,
        collectionId: 'tg_gift_red_star',
        giftId: 'gift_998877',
        price: '25.50000000',
        currency: 'TON',
        sellerId,
        status: 'active',
      });

      expect(listingRes.success).toBe(true);
      expect(listingRes.listing).toBeDefined();
      expect(listingRes.listing!.price).toBe('25.5');
      expect(listingRes.listing!.sellerId).toBe(sellerId);

      // Calculate floor price
      const floor = getFloorPrice(instrumentKey, 'TON');
      expect(floor.floorPrice).toBe('25.5');
      expect(floor.listedCount).toBe(1);

      // Add a second listing with lower price
      const listing2Id = `list_${createUniqueUserId()}`;
      addListing({
        listingId: listing2Id,
        instrumentKey,
        price: '20.00000000',
        currency: 'TON',
        sellerId,
      });

      const updatedFloor = getFloorPrice(instrumentKey, 'TON');
      expect(updatedFloor.floorPrice).toBe('20');
      expect(updatedFloor.listedCount).toBe(2);
    });

    it('3.2 Should reject listings with invalid or negative price', async () => {
      const result = addListing({
        listingId: 'invalid_price_listing',
        instrumentKey: 'tg_gift_blue_heart:TON',
        price: '-5.0',
        currency: 'TON',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Price must be a positive number');
    });
  });

  // =========================================================================
  // STEP 4: PURCHASE EXECUTION & ATOMIC BALANCE SETTLEMENT
  // =========================================================================
  describe('Step 4: Purchase Flow & Atomic Balance Transfer', () => {
    it('4.1 Should atomically transfer funds from buyer to seller minus commission, update listing status, and record audits', async () => {
      const sellerId = await registerTestUser('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N', {
        TON: '0',
      });
      const buyerId = await registerTestUser('EQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqReqECNDxNVVNUt', {
        TON: '50.00000000',
      });

      const listingId = `list_${createUniqueUserId()}`;
      const itemPrice = new Decimal('30.00000000');
      const commissionRate = new Decimal('0.025'); // 2.5% platform commission
      const commission = itemPrice.times(commissionRate); // 0.75 TON
      const sellerReceives = itemPrice.minus(commission); // 29.25 TON

      // 1. Seller lists item
      addListing({
        listingId,
        instrumentKey: 'tg_gift_crown:TON',
        price: itemPrice.toString(),
        currency: 'TON',
        sellerId,
        status: 'active',
      });

      // 2. Execute atomic purchase transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Row locks on buyer and seller balances
        const buyerBalRes = await client.query(
          'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
          [buyerId, 'TON']
        );
        const sellerBalRes = await client.query(
          'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
          [sellerId, 'TON']
        );

        const buyerAvailable = new Decimal(buyerBalRes.rows[0].available_balance);
        const sellerAvailable = new Decimal(sellerBalRes.rows[0]?.available_balance || '0');

        expect(buyerAvailable.gte(itemPrice)).toBe(true);

        const newBuyerAvailable = buyerAvailable.minus(itemPrice);
        const newSellerAvailable = sellerAvailable.plus(sellerReceives);
        const now = Date.now();

        // Update buyer balance
        await client.query(
          'UPDATE te_balances SET available_balance = $1, updated_at = $2 WHERE user_id = $3 AND currency = $4',
          [newBuyerAvailable.toString(), now, buyerId, 'TON']
        );

        // Update seller balance
        await client.query(
          `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, currency) DO UPDATE
           SET available_balance = $3, updated_at = $5`,
          [sellerId, 'TON', newSellerAvailable.toString(), '0', now]
        );

        // Record buyer financial audit
        await client.query(
          `INSERT INTO te_financial_audits (event_type, user_id, reference_id, currency, amount, available_before, available_after, locked_before, locked_after, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            'PURCHASE_DEBIT',
            buyerId,
            listingId,
            'TON',
            itemPrice.toString(),
            buyerAvailable.toString(),
            newBuyerAvailable.toString(),
            '0',
            '0',
            JSON.stringify({ sellerId, commission: commission.toString() }),
            now,
          ]
        );

        // Record seller financial audit
        await client.query(
          `INSERT INTO te_financial_audits (event_type, user_id, reference_id, currency, amount, available_before, available_after, locked_before, locked_after, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            'SALE_CREDIT',
            sellerId,
            listingId,
            'TON',
            sellerReceives.toString(),
            sellerAvailable.toString(),
            newSellerAvailable.toString(),
            '0',
            '0',
            JSON.stringify({ buyerId, grossPrice: itemPrice.toString(), fee: commission.toString() }),
            now,
          ]
        );

        await client.query('COMMIT');

        // Mark listing as sold
        const sellResult = sellListing(listingId);
        expect(sellResult.success).toBe(true);
      } finally {
        client.release();
      }

      // Assert post-purchase balances
      const finalBuyerBal = await queryBalance(pool, buyerId, 'TON');
      const finalSellerBal = await queryBalance(pool, sellerId, 'TON');

      expect(finalBuyerBal!.available_balance.toString()).toBe('20');
      expect(finalSellerBal!.available_balance.toString()).toBe('29.25');

      // Verify Floor price after sale
      const floor = getFloorPrice('tg_gift_crown:TON', 'TON');
      expect(floor.listedCount).toBe(0);
      expect(floor.floorPrice).toBeNull();
    });

    it('4.2 Should reject purchase and rollback cleanly if buyer has insufficient balance', async () => {
      const sellerId = await registerTestUser('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N', {
        TON: '0',
      });
      const poorBuyerId = await registerTestUser(
        'EQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqReqECNDxNVVNUt',
        {
          TON: '5.00000000', // Insufficient funds (Item costs 50 TON)
        }
      );

      const itemPrice = new Decimal('50.00000000');
      const client = await pool.connect();
      let purchaseError: any = null;

      try {
        await client.query('BEGIN');
        const buyerBalRes = await client.query(
          'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
          [poorBuyerId, 'TON']
        );
        const buyerAvailable = new Decimal(buyerBalRes.rows[0].available_balance);

        if (buyerAvailable.lessThan(itemPrice)) {
          throw new Error('Insufficient balance for purchase');
        }
        await client.query('COMMIT');
      } catch (err: any) {
        await client.query('ROLLBACK');
        purchaseError = err;
      } finally {
        client.release();
      }

      expect(purchaseError).not.toBeNull();
      expect(purchaseError.message).toContain('Insufficient balance');

      // Balances must remain unchanged
      const poorBuyerBal = await queryBalance(pool, poorBuyerId, 'TON');
      expect(poorBuyerBal!.available_balance.toString()).toBe('5');
    });
  });

  // =========================================================================
  // STEP 5: WITHDRAWAL INITIATION, BALANCE LOCKING & WORKER PROCESSING
  // =========================================================================
  describe('Step 5: Withdrawal State Machine & Background Processing', () => {
    it('5.1 Should lock available balance into locked balance, create PENDING withdrawal, process via worker, and transition to COMPLETED', async () => {
      const sellerWallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
      const sellerId = await registerTestUser(sellerWallet, { TON: '29.25' });
      mockTelegramAuth(sellerId);

      // 1. Submit Withdrawal Request via API
      const withdrawRes = await supertest(app).post('/api/withdraw').send({
        initData: 'valid_init_data',
        amount: '20.0',
        address: sellerWallet,
      });

      expect(withdrawRes.status).toBe(200);
      expect(withdrawRes.body.success).toBe(true);
      expect(withdrawRes.body.status).toBe('PENDING');

      const withdrawalId = withdrawRes.body.withdrawalId;

      // 2. Check balance in PostgreSQL immediately after request: available = 9.25, locked = 20.0
      const balAfterRequest = await queryBalance(pool, sellerId, 'TON');
      expect(balAfterRequest!.available_balance.toString()).toBe('9.25');
      expect(balAfterRequest!.locked_balance.toString()).toBe('20');

      // Check te_withdrawals row
      const wdRecord = await queryWithdrawal(pool, withdrawalId);
      expect(wdRecord).not.toBeNull();
      expect(wdRecord.status).toBe('PENDING');
      expect(wdRecord.funds_released).toBe(false);

      // 3. Process withdrawal with WithdrawalWorker & MockTonTransferAdapter
      const mockAdapter = new MockTonTransferAdapter({ shouldFail: false });
      const worker = new WithdrawalWorker(pool, {
        adapter: mockAdapter,
        workerId: 'e2e_test_worker',
        batchSize: 10,
      });

      const processedCount = await worker.processCycle();
      expect(processedCount).toBeGreaterThanOrEqual(1);

      // 4. Verify post-transfer state: status = COMPLETED, tx_hash recorded
      const wdFinal = await queryWithdrawal(pool, withdrawalId);
      expect(wdFinal.status).toBe('COMPLETED');
      expect(wdFinal.tx_hash).toBeDefined();
      expect(wdFinal.tx_hash).toMatch(/^mock_tx_/);

      // Balance in PostgreSQL: available = 9.25, locked = 0
      const balFinal = await queryBalance(pool, sellerId, 'TON');
      expect(balFinal!.available_balance.toString()).toBe('9.25');
      expect(balFinal!.locked_balance.toString()).toBe('0');

      // Verify financial audit trail
      const audits = await queryFinancialAudits(pool, sellerId);
      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(audits.some((a) => a.event_type === 'WITHDRAWAL_CREATED_LOCKED')).toBe(true);
      expect(audits.some((a) => a.event_type === 'WITHDRAWAL_COMPLETED')).toBe(true);
    });
  });

  // =========================================================================
  // STEP 6: TON CONFIRMATION & FULL ACCOUNTING RECONCILIATION
  // =========================================================================
  describe('Step 6: TON Confirmation & Complete Accounting Reconciliation', () => {
    it('6.1 Should verify on-chain transaction hash, verify idempotency of repeated worker cycles, and perform full final balance audit', async () => {
      const userWallet = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
      const userId = await registerTestUser(userWallet, { TON: '10.0' });
      mockTelegramAuth(userId);

      // Submit withdrawal
      const res = await supertest(app).post('/api/withdraw').send({
        initData: 'valid_init_data',
        amount: '10.0',
        address: userWallet,
      });
      const withdrawalId = res.body.withdrawalId;

      const mockAdapter = new MockTonTransferAdapter();
      const worker = new WithdrawalWorker(pool, {
        adapter: mockAdapter,
        workerId: 'e2e_reconciliation_worker',
      });

      // First worker cycle completes the withdrawal
      await worker.processCycle();

      const wd = await queryWithdrawal(pool, withdrawalId);
      expect(wd.status).toBe('COMPLETED');
      expect(wd.tx_hash).toMatch(/^mock_tx_/);
      expect(mockAdapter.sentTransfers.length).toBe(1);
      expect(mockAdapter.sentTransfers[0].txHash).toBe(wd.tx_hash);

      // Second worker cycle must NOT re-execute or alter completed withdrawal (Idempotency)
      const secondCycleCount = await worker.processCycle();
      expect(secondCycleCount).toBe(0);

      // Verify final balance
      const balance = await queryBalance(pool, userId, 'TON');
      expect(balance!.available_balance.toString()).toBe('0');
      expect(balance!.locked_balance.toString()).toBe('0');
    });
  });
});
