import express from 'express';
import { validateTelegramInitData } from '../telegramAuth';
import { getPgPool } from '../marketRepository';

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
  if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }

  const client = await getPgPool().connect();
  try {
    await client.query(
      `INSERT INTO te_users (id, wallet_address)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE
       SET wallet_address = $2`,
      [verifiedUserId, walletAddress.trim()]
    );

    return res.json({ success: true, userId: verifiedUserId, walletAddress: walletAddress.trim() });
  } catch (e) {
    console.error('[UserWallet] Error saving wallet:', e);
    return res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

// 2. Withdrawal Request with State Machine & Balance Locking
router.post('/withdraw', async (req: express.Request, res: express.Response) => {
  const { amount, address, initData } = req.body;
  const headerInitData = (req.headers['x-telegram-init-data'] as string) || initData;

  if (!headerInitData) {
    return res.status(401).json({ error: 'Unauthorized: Telegram initData is required.' });
  }

  const authResult = validateTelegramInitData(headerInitData);
  if (!authResult.isValid || !authResult.user?.id) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Telegram signature.' });
  }

  const verifiedUserId = String(authResult.user.id);
  const numAmount = Number(amount);

  if (isNaN(numAmount) || numAmount < 0.1) {
    return res.status(400).json({ error: 'Minimum withdrawal is 0.1 TON.' });
  }

  if (!address || typeof address !== 'string' || address.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid destination wallet address.' });
  }

  const client = await getPgPool().connect();
  try {
    await client.query('BEGIN');

    // 1. Verify bound wallet
    const userCheck = await client.query('SELECT wallet_address FROM te_users WHERE id = $1', [verifiedUserId]);
    if (userCheck.rows.length === 0 || !userCheck.rows[0].wallet_address) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No wallet registered for this user. Please connect wallet first.' });
    }

    if (userCheck.rows[0].wallet_address.trim().toLowerCase() !== address.trim().toLowerCase()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Withdrawal destination must match your registered wallet.' });
    }

    // 2. Lock balance and verify available funds
    const balanceRes = await client.query(
      'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
      [verifiedUserId, 'TON']
    );

    const availableBalance = balanceRes.rows[0]?.available_balance ? Number(balanceRes.rows[0].available_balance) : 0;
    if (availableBalance < numAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Insufficient available balance: ${availableBalance} TON available, ${numAmount} TON requested.`,
      });
    }

    // 3. Move funds from available to locked in ACID transaction (Withdrawal State Machine)
    const withdrawalId = `wd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();

    await client.query(
      `UPDATE te_balances 
       SET available_balance = available_balance - $1,
           locked_balance = locked_balance + $1,
           updated_at = $2
       WHERE user_id = $3 AND currency = $4`,
      [numAmount, now, verifiedUserId, 'TON']
    );

    // 4. Create record in te_withdrawals table with status PENDING
    await client.query(
      `INSERT INTO te_withdrawals (id, user_id, amount, currency, address, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [withdrawalId, verifiedUserId, numAmount, 'TON', address.trim(), 'PENDING', now, now]
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
          amount: numAmount,
          currency: 'TON',
          address: address.trim(),
          status: 'PENDING',
        }),
        'pending',
        'TON',
        now,
      ]
    );

    await client.query('COMMIT');

    console.log(`[Withdraw] User ${verifiedUserId} requested ${numAmount} TON withdrawal (ID: ${withdrawalId}). Status: PENDING.`);
    return res.json({
      success: true,
      withdrawalId,
      status: 'PENDING',
      amount: numAmount,
      message: 'Withdrawal queued successfully.',
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('[Withdraw] Error in withdrawal creation:', e);
    return res.status(500).json({ error: 'Internal error processing withdrawal request.' });
  } finally {
    client.release();
  }
});

// 3. Telegram Stars Invoice Creation
router.post('/create-invoice', async (req: express.Request, res: express.Response) => {
  const { giftId, starsAmount, initData } = req.body;
  const headerInitData = (req.headers['x-telegram-init-data'] as string) || initData;

  if (!headerInitData) {
    return res.status(401).json({ error: 'Unauthorized: Telegram initData is required.' });
  }

  const authResult = validateTelegramInitData(headerInitData);
  if (!authResult.isValid || !authResult.user?.id) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Telegram signature.' });
  }

  const verifiedUserId = String(authResult.user.id);
  const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return res.status(500).json({ error: 'BOT_TOKEN or TELEGRAM_BOT_TOKEN is not configured.' });
  }

  const validStarsAmounts = [10, 50, 100, 250, 500, 1000, 2500, 5000];
  const requestedStars = Number(starsAmount);
  if (!validStarsAmounts.includes(requestedStars)) {
    return res.status(400).json({ error: `Invalid stars amount. Allowed: ${validStarsAmounts.join(', ')}` });
  }

  const invoicePayload = JSON.stringify({
    userId: verifiedUserId,
    giftId: giftId || 'general_deposit',
    stars: requestedStars,
    timestamp: Date.now(),
    nonce: Math.random().toString(36).substring(2, 10),
  });

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `GX Stars Deposit: ${requestedStars} Stars`,
        description: `Top-up exchange balance with ${requestedStars} Telegram Stars for user #${verifiedUserId}`,
        payload: invoicePayload,
        provider_token: '', // Must be empty for Telegram Stars (XTR)
        currency: 'XTR',
        prices: [{ label: `${requestedStars} Stars`, amount: requestedStars }],
      }),
    });
    const data = await response.json();
    if (data.ok) {
      res.json({ invoiceLink: data.result, payload: invoicePayload });
    } else {
      console.error('Telegram API Error:', data);
      res.status(400).json({ error: data.description || 'Failed to create invoice link.' });
    }
  } catch (error) {
    console.error('Error creating invoice link:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
