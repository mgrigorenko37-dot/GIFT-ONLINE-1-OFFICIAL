import express from 'express';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import { validateTelegramInitData } from '../telegramAuth';
import { getPgPool } from '../marketRepository';
import { WithdrawalStateMachine, WithdrawalTransitionError } from '../withdrawalStateMachine';
import { validateAndConvertToNano } from '../tonAdapter';
import {
  createStarsInvoice,
  validatePreCheckout,
  processSuccessfulStarsPayment,
} from '../invoiceService';
import { webhookRateLimiter, validateTelegramWebhookSecret } from '../rateLimiter';

const router = express.Router();

// 1. Register/Update User Wallet
router.post('/user/wallet', async (req: express.Request, res: express.Response) => {
  const { walletAddress, initData } = req.body;
  const headerInitData = (req.headers['x-telegram-init-data'] as string) || initData;

  if (!headerInitData) {
    return res.status(401).json({ error: 'Unauthorized: Telegram initData is required.' });
  }

  const authResult = validateTelegramInitData(headerInitData);
  if (!authResult.isValid || !authResult.user?.id) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Telegram signature.' });
  }

  const verifiedUserId = String(authResult.user.id);
  let normalizedWallet: string;
  try {
    const { Address } = require('@ton/core');
    normalizedWallet = Address.parse(walletAddress.trim()).toRawString();
  } catch {
    return res.status(400).json({ error: 'Invalid TON wallet address format.' });
  }

  const client = await getPgPool().connect();
  try {
    await client.query(
      `INSERT INTO te_users (id, wallet_address)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE
       SET wallet_address = $2`,
      [verifiedUserId, normalizedWallet]
    );

    return res.json({ success: true, userId: verifiedUserId, walletAddress: normalizedWallet });
  } catch (e) {
    console.error('[UserWallet] Error saving wallet:', e);
    return res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// 2. Withdrawal Request with State Machine & Balance Locking
router.post('/withdraw', async (req: express.Request, res: express.Response) => {
  const { amount, address, initData, idempotencyKey } = req.body;
  const headerInitData = (req.headers['x-telegram-init-data'] as string) || initData;

  if (!headerInitData) {
    return res.status(401).json({ error: 'Unauthorized: Telegram initData is required.' });
  }

  const authResult = validateTelegramInitData(headerInitData);
  if (!authResult.isValid || !authResult.user?.id) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Telegram signature.' });
  }

  const verifiedUserId = String(authResult.user.id);

  if (
    amount === undefined ||
    amount === null ||
    typeof amount === 'boolean' ||
    (typeof amount !== 'string' && typeof amount !== 'number')
  ) {
    return res.status(400).json({ error: 'Invalid amount format.' });
  }

  const strAmount = String(amount).trim();
  const validation = validateAndConvertToNano(strAmount);
  if (!validation.isValid || !validation.amountDecimal) {
    return res.status(400).json({ error: validation.error || 'Invalid withdrawal amount.' });
  }

  const amountDecimal = validation.amountDecimal;
  if (amountDecimal.lessThan('0.1')) {
    return res.status(400).json({ error: 'Minimum withdrawal is 0.1 TON.' });
  }

  let normalizedAddress: string;
  try {
    const { Address } = require('@ton/core');
    normalizedAddress = Address.parse(address.trim()).toRawString();
  } catch {
    return res.status(400).json({ error: 'Invalid TON destination wallet address format.' });
  }

  const client = await getPgPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Verify bound wallet
    const userCheck = await client.query('SELECT wallet_address FROM te_users WHERE id = $1', [
      verifiedUserId,
    ]);
    if (userCheck.rows.length === 0 || !userCheck.rows[0].wallet_address) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .json({ error: 'No wallet registered for this user. Please connect wallet first.' });
    }

    if (
      userCheck.rows[0].wallet_address &&
      userCheck.rows[0].wallet_address.toLowerCase() !== normalizedAddress.toLowerCase()
    ) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .json({ error: 'Withdrawal destination must match your registered wallet.' });
    }

    // 2. Lock balance and verify available funds
    const balanceRes = await client.query(
      'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
      [verifiedUserId, 'TON']
    );

    const availableBefore = new Decimal(balanceRes.rows[0]?.available_balance || 0);
    const lockedBefore = new Decimal(balanceRes.rows[0]?.locked_balance || 0);

    if (availableBefore.lessThan(amountDecimal)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Insufficient available balance: ${availableBefore.toString()} TON available, ${amountDecimal.toString()} TON requested.`,
      });
    }

    const availableAfter = availableBefore.minus(amountDecimal);
    const lockedAfter = lockedBefore.plus(amountDecimal);

    // 3. Move funds from available to locked in ACID transaction (Withdrawal State Machine)
    const withdrawalId = `wd_${crypto.randomUUID()}`;
    const operationId = idempotencyKey ? String(idempotencyKey) : `op_wd_${withdrawalId.replace(/^wd_/, '')}`;
    const now = Date.now();

    await client.query(
      `UPDATE te_balances 
       SET available_balance = $1,
           locked_balance = $2,
           updated_at = $3
       WHERE user_id = $4 AND currency = $5`,
      [availableAfter.toString(), lockedAfter.toString(), now, verifiedUserId, 'TON']
    );

    // Record audit entry
    await WithdrawalStateMachine.recordFinancialAudit(
      client,
      'WITHDRAWAL_CREATED_LOCKED',
      verifiedUserId,
      withdrawalId,
      'TON',
      amountDecimal,
      availableBefore,
      availableAfter,
      lockedBefore,
      lockedAfter,
      { address: normalizedAddress, operationId },
      now
    );

    // 4. Create record in te_withdrawals table with status PENDING and UNIQUE operation_id
    await client.query(
      `INSERT INTO te_withdrawals (id, operation_id, user_id, amount, currency, address, status, funds_released, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        withdrawalId,
        operationId,
        verifiedUserId,
        amountDecimal.toString(),
        'TON',
        normalizedAddress,
        'PENDING',
        false,
        now,
        now,
      ]
    );

    // 5. Emit Outbox Event for background processing worker
    await client.query(
      `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'withdrawalCreated',
        verifiedUserId,
        JSON.stringify({
          withdrawalId,
          userId: verifiedUserId,
          amount: amountDecimal.toString(),
          currency: 'TON',
          address: normalizedAddress,
          status: 'PENDING',
        }),
        'pending',
        'TON',
        now,
      ]
    );

    await client.query('COMMIT');

    console.log(
      `[Withdraw] User ${verifiedUserId} requested ${amountDecimal.toString()} TON withdrawal (ID: ${withdrawalId}). Status: PENDING.`
    );
    return res.json({
      success: true,
      withdrawalId,
      status: 'PENDING',
      amount: amountDecimal.toString(),
      message: 'Withdrawal queued successfully.',
    });
  } catch (e: any) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    
    if (e.code === '23505' && e.constraint === 'te_withdrawals_operation_id_key') {
      return res.status(409).json({ error: 'Duplicate withdrawal request.', code: 'DUPLICATE_OPERATION' });
    }
    
    console.error('[Withdraw] Error in withdrawal creation:', e);
    return res.status(500).json({ error: 'Internal error processing withdrawal request.' });
  } finally {
    client.release();
  }
});

// 3. Retry Failed Withdrawal (Admin / Explicit User Action)
router.post('/withdraw/:id/retry', async (req: express.Request, res: express.Response) => {
  const withdrawalId = String(req.params.id);
  const { initData } = req.body;
  const headerInitData = (req.headers['x-telegram-init-data'] as string) || initData;

  if (!headerInitData) {
    return res.status(401).json({ error: 'Unauthorized: Telegram initData is required.' });
  }

  const authResult = validateTelegramInitData(headerInitData);
  if (!authResult.isValid || !authResult.user?.id) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Telegram signature.' });
  }

  const verifiedUserId = String(authResult.user.id);
  const client = await getPgPool().connect();

  try {
    await client.query('BEGIN');

    // Verify ownership
    const checkOwner = await client.query('SELECT user_id FROM te_withdrawals WHERE id = $1', [
      withdrawalId,
    ]);
    if (checkOwner.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Withdrawal not found.' });
    }

    if (checkOwner.rows[0].user_id !== verifiedUserId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden: You do not own this withdrawal.' });
    }

    const updatedRecord = await WithdrawalStateMachine.retryFailedWithdrawal(client, withdrawalId);
    await client.query('COMMIT');

    return res.json({
      success: true,
      withdrawal: updatedRecord,
      message: 'Withdrawal retried and queued for processing.',
    });
  } catch (e: any) {
    try {
      await client.query('ROLLBACK');
    } catch {}

    if (e instanceof WithdrawalTransitionError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    console.error('[Withdraw Retry] Error:', e);
    return res.status(500).json({ error: 'Internal error retrying withdrawal.' });
  } finally {
    client.release();
  }
});

// 4. Telegram Stars Invoice Creation (Strictly Validated & Persisted)
router.post('/create-invoice', async (req: express.Request, res: express.Response) => {
  const { giftId, starsAmount, initData, idempotencyKey } = req.body;
  const headerInitData = (req.headers['x-telegram-init-data'] as string) || initData;

  const result = await createStarsInvoice({
    initData: headerInitData,
    starsAmount: Number(starsAmount),
    giftId: giftId ? String(giftId) : undefined,
    idempotencyKey: idempotencyKey ? String(idempotencyKey) : undefined,
  });

  if (!result.success) {
    const status = result.code === 'UNAUTHORIZED' || result.code === 'INVALID_AUTH' ? 401 : 400;
    return res.status(status).json({ error: result.error, code: result.code });
  }

  return res.json({
    success: true,
    invoiceId: result.invoiceId,
    invoiceLink: result.invoiceLink,
    starsAmount: result.starsAmount,
    currency: result.currency,
    payload: result.payload,
  });
});

// 5. Telegram Webhook Updates (pre_checkout_query & successful_payment handling)
router.post(
  '/telegram/payment-webhook',
  webhookRateLimiter,
  validateTelegramWebhookSecret,
  async (req: express.Request, res: express.Response) => {
    const update = req.body;
    const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

    if (!update || typeof update !== 'object') {
      return res.status(400).json({ error: 'Invalid update body' });
    }

    // A. Pre-checkout query
    if (update.pre_checkout_query) {
      const pcq = update.pre_checkout_query;
      const validation = await validatePreCheckout(pcq);

      if (botToken) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pre_checkout_query_id: pcq.id,
              ok: validation.ok,
              error_message: validation.ok
                ? undefined
                : validation.errorMessage || 'Invalid payment parameters',
            }),
          });
        } catch (botErr) {
          console.error('[PaymentWebhook] Error answering pre-checkout query:', botErr);
        }
      }

      return res.json({ ok: validation.ok, error_message: validation.errorMessage });
    }

    // B. Successful payment in message
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const telegramUserId = update.message.from?.id;

      const result = await processSuccessfulStarsPayment(payment, telegramUserId);

      if (!result.success && !result.duplicate) {
        return res.status(400).json({ error: result.error, code: result.code });
      }

      return res.json({
        ok: true,
        duplicate: result.duplicate,
        invoiceId: result.invoiceId,
        userId: result.userId,
        starsCredited: result.starsCredited,
      });
    }

    return res.json({ ok: true, ignored: true });
  }
);

export default router;
