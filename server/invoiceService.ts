import { PoolClient } from 'pg';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import { getPgPool } from './marketRepository';
import { validateTelegramInitData } from './telegramAuth';

export interface TelegramStarsInvoice {
  id: string;
  user_id: string;
  stars_amount: number;
  currency: string;
  payload: string;
  nonce: string;
  idempotency_key?: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  invoice_link?: string;
  telegram_payment_charge_id?: string;
  telegram_provider_charge_id?: string;
  created_at: number;
  paid_at?: number;
  failure_reason?: string;
}

export interface CreateInvoiceParams {
  initData: string;
  starsAmount: number;
  giftId?: string;
  idempotencyKey?: string;
}

export interface CreateInvoiceResult {
  success: boolean;
  invoiceId?: string;
  invoiceLink?: string;
  starsAmount?: number;
  currency?: string;
  payload?: string;
  error?: string;
  code?: string;
}

export interface PreCheckoutQuery {
  id: string;
  from: {
    id: number | string;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
  };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

export interface ProcessPaymentResult {
  success: boolean;
  duplicate: boolean;
  invoiceId?: string;
  userId?: string;
  starsCredited?: number;
  balanceAfter?: string;
  error?: string;
  code?: string;
}

export const ALLOWED_STARS_AMOUNTS = [10, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * Creates a persisted Stars invoice in PostgreSQL and requests an invoiceLink from Telegram Bot API.
 */
export async function createStarsInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult> {
  const { initData, starsAmount, giftId, idempotencyKey } = params;

  if (!initData) {
    return { success: false, error: 'Unauthorized: Telegram initData is required.', code: 'UNAUTHORIZED' };
  }

  const authResult = validateTelegramInitData(initData);
  if (!authResult.isValid || !authResult.user?.id) {
    return { success: false, error: 'Unauthorized: Invalid Telegram signature.', code: 'INVALID_AUTH' };
  }

  const verifiedUserId = String(authResult.user.id);
  const requestedStars = Number(starsAmount);

  if (!ALLOWED_STARS_AMOUNTS.includes(requestedStars)) {
    return {
      success: false,
      error: `Invalid stars amount. Allowed amounts: ${ALLOWED_STARS_AMOUNTS.join(', ')}`,
      code: 'INVALID_AMOUNT',
    };
  }

  const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return { success: false, error: 'Telegram bot token is not configured on server.', code: 'CONFIG_ERROR' };
  }

  const pool = getPgPool();
  const client = await pool.connect();

  try {
    // 1. If idempotency key provided, check if invoice already exists
    if (idempotencyKey && idempotencyKey.trim() !== '') {
      const existing = await client.query(
        `SELECT id, user_id, stars_amount, currency, payload, status, invoice_link 
         FROM te_invoices 
         WHERE idempotency_key = $1 AND user_id = $2`,
        [idempotencyKey.trim(), verifiedUserId]
      );

      if (existing.rows.length > 0) {
        const inv = existing.rows[0];
        return {
          success: true,
          invoiceId: inv.id,
          invoiceLink: inv.invoice_link,
          starsAmount: Number(inv.stars_amount),
          currency: inv.currency,
          payload: inv.payload,
        };
      }
    }

    const invoiceId = `inv_${crypto.randomUUID()}`;
    const nonce = crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    const serverGeneratedPayload = JSON.stringify({
      invoiceId,
      userId: verifiedUserId,
      giftId: giftId || 'general_deposit',
      stars: requestedStars,
      timestamp: now,
      nonce,
    });

    // 2. Pre-insert invoice record in PostgreSQL with PENDING status
    await client.query(
      `INSERT INTO te_invoices (
        id, user_id, stars_amount, currency, payload, nonce, idempotency_key, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)`,
      [
        invoiceId,
        verifiedUserId,
        requestedStars,
        'XTR',
        serverGeneratedPayload,
        nonce,
        idempotencyKey ? idempotencyKey.trim() : null,
        now,
      ]
    );

    // 3. Call Telegram Bot API createInvoiceLink
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `GX Stars Deposit: ${requestedStars} Stars`,
          description: `Top-up exchange balance with ${requestedStars} Telegram Stars for user #${verifiedUserId}`,
          payload: serverGeneratedPayload,
          provider_token: '', // Must be empty string for Telegram Stars (XTR)
          currency: 'XTR',
          prices: [{ label: `${requestedStars} Stars`, amount: requestedStars }],
        }),
      });
    } catch (networkErr: any) {
      console.error('[InvoiceService] Network failure calling Telegram API:', networkErr?.message);
      await client.query(
        `UPDATE te_invoices SET status = 'FAILED', failure_reason = $1 WHERE id = $2`,
        [`Telegram API network error: ${networkErr?.message}`, invoiceId]
      );
      return { success: false, error: 'Telegram API unreachable.', code: 'TELEGRAM_NETWORK_ERROR' };
    }

    const data: any = await response.json();
    if (!data.ok || !data.result) {
      console.error('[InvoiceService] Telegram API Error creating invoice link:', data);
      await client.query(
        `UPDATE te_invoices SET status = 'FAILED', failure_reason = $1 WHERE id = $2`,
        [data.description || 'Failed to create invoice link in Telegram', invoiceId]
      );
      return {
        success: false,
        error: data.description || 'Failed to create Telegram invoice link.',
        code: 'TELEGRAM_API_ERROR',
      };
    }

    const invoiceLink = data.result;

    // 4. Update invoice with generated invoice_link
    await client.query(
      `UPDATE te_invoices SET invoice_link = $1 WHERE id = $2`,
      [invoiceLink, invoiceId]
    );

    return {
      success: true,
      invoiceId,
      invoiceLink,
      starsAmount: requestedStars,
      currency: 'XTR',
      payload: serverGeneratedPayload,
    };
  } finally {
    client.release();
  }
}

/**
 * Validates pre_checkout_query from Telegram webhook.
 * Ensures the invoice exists, is PENDING, user ID matches, and stars amount matches.
 */
export async function validatePreCheckout(preCheckout: PreCheckoutQuery): Promise<{ ok: boolean; errorMessage?: string }> {
  if (!preCheckout || !preCheckout.invoice_payload) {
    return { ok: false, errorMessage: 'Invalid pre-checkout payload' };
  }

  let payloadData: any;
  try {
    payloadData = JSON.parse(preCheckout.invoice_payload);
  } catch {
    return { ok: false, errorMessage: 'Malformed payload JSON' };
  }

  const { invoiceId, userId, stars } = payloadData;
  if (!invoiceId || !userId || !stars) {
    return { ok: false, errorMessage: 'Incomplete invoice payload fields' };
  }

  // Verify Telegram sender matches payload user
  if (String(preCheckout.from.id) !== String(userId)) {
    return { ok: false, errorMessage: 'User ID mismatch between Telegram sender and invoice' };
  }

  if (Number(preCheckout.total_amount) !== Number(stars)) {
    return { ok: false, errorMessage: 'Payment amount mismatch' };
  }

  const pool = getPgPool();
  const client = await pool.connect();

  try {
    const res = await client.query(
      `SELECT id, user_id, stars_amount, status FROM te_invoices WHERE id = $1`,
      [invoiceId]
    );

    if (res.rows.length === 0) {
      return { ok: false, errorMessage: 'Invoice not found' };
    }

    const inv = res.rows[0];
    if (inv.status === 'PAID') {
      return { ok: false, errorMessage: 'Invoice has already been paid' };
    }

    if (inv.status === 'FAILED' || inv.status === 'EXPIRED') {
      return { ok: false, errorMessage: `Invoice is ${inv.status.toLowerCase()}` };
    }

    if (String(inv.user_id) !== String(userId)) {
      return { ok: false, errorMessage: 'Invoice user ownership mismatch' };
    }

    if (Number(inv.stars_amount) !== Number(stars)) {
      return { ok: false, errorMessage: 'Invoice amount mismatch' };
    }

    return { ok: true };
  } finally {
    client.release();
  }
}

/**
 * Atomically processes successful_payment from Telegram webhook:
 * - Verifies payload structure & invoice state
 * - Protects against duplicate payments (Idempotency & UNIQUE constraints)
 * - Credits user STARS balance in an ACID transaction
 * - Records financial audit log and outbox event
 */
export async function processSuccessfulStarsPayment(
  payment: SuccessfulPayment,
  telegramUserId: string | number
): Promise<ProcessPaymentResult> {
  if (!payment || !payment.invoice_payload) {
    return { success: false, duplicate: false, error: 'Missing payment payload', code: 'MISSING_PAYLOAD' };
  }

  let payloadData: any;
  try {
    payloadData = JSON.parse(payment.invoice_payload);
  } catch {
    return { success: false, duplicate: false, error: 'Malformed payload JSON', code: 'MALFORMED_PAYLOAD' };
  }

  const { invoiceId, userId, stars } = payloadData;
  if (!invoiceId || !userId || !stars) {
    return { success: false, duplicate: false, error: 'Incomplete invoice payload fields', code: 'INVALID_PAYLOAD' };
  }

  // Verify that payment user ID matches user ID in the signed payload
  if (String(telegramUserId) !== String(userId)) {
    console.warn(`[InvoicePayment] Security violation: telegramUserId (${telegramUserId}) !== payload.userId (${userId})`);
    return {
      success: false,
      duplicate: false,
      error: 'Security violation: Payment sender does not match invoice recipient.',
      code: 'USER_MISMATCH',
    };
  }

  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock invoice row for update
    const invoiceRes = await client.query(
      `SELECT id, user_id, stars_amount, currency, status, telegram_payment_charge_id 
       FROM te_invoices 
       WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );

    if (invoiceRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, duplicate: false, error: 'Invoice not found in database', code: 'INVOICE_NOT_FOUND' };
    }

    const invoice = invoiceRes.rows[0];

    // 2. Check for duplicate processing
    if (invoice.status === 'PAID') {
      await client.query('ROLLBACK');
      console.log(`[InvoicePayment] Duplicate payment webhook ignored for invoice ${invoiceId} (Already PAID).`);
      return {
        success: true,
        duplicate: true,
        invoiceId,
        userId: String(userId),
        starsCredited: Number(invoice.stars_amount),
      };
    }

    // 3. Check for telegram_payment_charge_id duplication across te_payments table
    const paymentCheck = await client.query(
      `SELECT id FROM te_payments WHERE telegram_payment_charge_id = $1`,
      [payment.telegram_payment_charge_id]
    );

    if (paymentCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`[InvoicePayment] Duplicate charge_id ${payment.telegram_payment_charge_id} ignored.`);
      return {
        success: true,
        duplicate: true,
        invoiceId,
        userId: String(userId),
      };
    }

    const now = Date.now();
    const starsAmountDecimal = new Decimal(Number(stars));

    // 4. Lock & update user balance for STARS currency
    const balanceRes = await client.query(
      `SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [String(userId), 'STARS']
    );

    const availableBefore = new Decimal(balanceRes.rows[0]?.available_balance || 0);
    const lockedBefore = new Decimal(balanceRes.rows[0]?.locked_balance || 0);
    const availableAfter = availableBefore.plus(starsAmountDecimal);

    await client.query(
      `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, created_at, updated_at)
       VALUES ($1, 'STARS', $2, 0, $3, $3)
       ON CONFLICT (user_id, currency) DO UPDATE
       SET available_balance = $2,
           updated_at = $3`,
      [String(userId), availableAfter.toString(), now]
    );

    // 5. Update invoice to PAID status
    await client.query(
      `UPDATE te_invoices 
       SET status = 'PAID',
           telegram_payment_charge_id = $1,
           telegram_provider_charge_id = $2,
           paid_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [
        payment.telegram_payment_charge_id,
        payment.provider_payment_charge_id || null,
        now,
        invoiceId,
      ]
    );

    // 6. Record payment in te_payments audit table
    const paymentRecordId = `pay_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO te_payments (
        id, invoice_id, user_id, amount, currency, telegram_payment_charge_id,
        telegram_provider_charge_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8)`,
      [
        paymentRecordId,
        invoiceId,
        String(userId),
        starsAmountDecimal.toString(),
        'STARS',
        payment.telegram_payment_charge_id,
        payment.provider_payment_charge_id || null,
        now,
      ]
    );

    // 7. Record financial audit trail
    await client.query(
      `INSERT INTO te_financial_audits (
        event_type, user_id, reference_id, currency, amount,
        available_before, available_after, locked_before, locked_after, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        'STARS_DEPOSIT_COMPLETED',
        String(userId),
        invoiceId,
        'STARS',
        starsAmountDecimal.toString(),
        availableBefore.toString(),
        availableAfter.toString(),
        lockedBefore.toString(),
        lockedBefore.toString(),
        JSON.stringify({
          chargeId: payment.telegram_payment_charge_id,
          providerChargeId: payment.provider_payment_charge_id,
          paymentRecordId,
        }),
        now,
      ]
    );

    // 8. Publish outbox event for realtime balance propagation
    await client.query(
      `INSERT INTO te_outbox_events (event_id, event_type, user_id, payload, status, currency, created_at)
       VALUES ($1, $2, $3, $4, 'pending', 'STARS', $5)`,
      [
        `evt_${crypto.randomUUID()}`,
        'balanceUpdated',
        String(userId),
        JSON.stringify({
          userId: String(userId),
          currency: 'STARS',
          availableBalance: availableAfter.toString(),
          lockedBalance: lockedBefore.toString(),
          reason: 'STARS_DEPOSIT',
          referenceId: invoiceId,
          amount: starsAmountDecimal.toString(),
        }),
        now,
      ]
    );

    await client.query('COMMIT');

    console.log(
      `[InvoicePayment] Successfully credited ${stars} STARS to user #${userId} for invoice ${invoiceId}. Balance: ${availableAfter.toString()} STARS.`
    );

    return {
      success: true,
      duplicate: false,
      invoiceId,
      userId: String(userId),
      starsCredited: Number(stars),
      balanceAfter: availableAfter.toString(),
    };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[InvoicePayment] Error processing successful payment:', err);
    return {
      success: false,
      duplicate: false,
      error: err?.message || 'Database error processing payment',
      code: 'DB_ERROR',
    };
  } finally {
    client.release();
  }
}
