import { Pool } from 'pg';
import Decimal from 'decimal.js';

export class TonScanner {
  private pool: Pool;
  private intervalId: NodeJS.Timeout | null = null;
  private isScanning: boolean = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  public start() {
    console.log(
      '[TonScanner] Starting robust background scanner with cursor tracking and sender verification...'
    );
    this.intervalId = setInterval(() => this.scan(), 10000); // Check every 10 seconds
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private normalizeAddress(addr: string | null | undefined): string | null {
    if (!addr) return null;
    try {
      const { Address } = require('@ton/core');
      return Address.parse(addr.trim()).toRawString().toLowerCase();
    } catch {
      return addr.trim().toLowerCase();
    }
  }

  private async getCursor(): Promise<number> {
    try {
      const res = await this.pool.query(
        "SELECT last_lt FROM te_ton_scanner_cursor WHERE id = 'main_scanner'"
      );
      if (res.rows.length > 0) {
        return Number(res.rows[0].last_lt) || 0;
      }
    } catch (e: any) {
      if (e?.code === '42P01' || e?.message?.includes('does not exist')) {
        return 0;
      }
      console.warn('[TonScanner] Could not read cursor, defaulting to 0:', e);
    }
    return 0;
  }

  private async updateCursor(lt: number, hash: string) {
    try {
      await this.pool.query(
        `INSERT INTO te_ton_scanner_cursor (id, last_lt, last_hash, updated_at)
         VALUES ('main_scanner', $1, $2, $3)
         ON CONFLICT (id)
         DO UPDATE SET last_lt = GREATEST(te_ton_scanner_cursor.last_lt, $1), last_hash = $2, updated_at = $3`,
        [lt, hash, Date.now()]
      );
    } catch (e) {
      console.error('[TonScanner] Failed to update scanner cursor:', e);
    }
  }

  private async scan() {
    if (this.isScanning) return;
    this.isScanning = true;

    const hotWallet = process.env.EXCHANGE_HOT_WALLET_ADDRESS;
    if (!hotWallet) {
      this.isScanning = false;
      return;
    }

    try {
      const lastLt = await this.getCursor();
      const url = `https://tonapi.io/v2/blockchain/accounts/${hotWallet}/transactions?limit=50`;
      const res = await fetch(url);
      if (!res.ok) {
        this.isScanning = false;
        return;
      }

      const data = await res.json();
      if (!data.transactions || !Array.isArray(data.transactions)) {
        this.isScanning = false;
        return;
      }

      // Filter transactions newer than cursor and sort ascending (oldest first)
      const validTxs = data.transactions
        .filter((tx: any) => tx && tx.in_msg && (!lastLt || Number(tx.lt) > lastLt))
        .sort((a: any, b: any) => Number(a.lt) - Number(b.lt));

      let highestProcessedLt = lastLt;
      let lastHash = '';

      for (const tx of validTxs) {
        const msg = tx.in_msg;
        const txLt = Number(tx.lt) || 0;
        const txHash = tx.hash;

        // Skip non-transfers or 0-value messages
        if (!msg.value || Number(msg.value) <= 0) {
          if (txLt > highestProcessedLt) highestProcessedLt = txLt;
          continue;
        }

        let processedOk = true;

        // Validate text comment format: Deposit_<userId>
        if (
          msg.decoded_op_name === 'text_comment' &&
          msg.decoded_body &&
          typeof msg.decoded_body.text === 'string'
        ) {
          const text = msg.decoded_body.text.trim();
          if (text.startsWith('Deposit_')) {
            const userId = text.substring('Deposit_'.length).trim();
            const amount = new Decimal(msg.value).div(1e9).toString();
            const senderRaw = msg.source?.address || msg.source || '';

            if (userId && new Decimal(amount).gt(0)) {
              processedOk = await this.processDeposit(txHash, txLt, userId, amount, senderRaw);
            }
          }
        }

        if (!processedOk) {
          console.warn(
            `[TonScanner] Halting scan due to system error in deposit processing (Tx: ${txHash})`
          );
          break; // Stop scanning further, keep highestProcessedLt at the last successful one
        }

        if (txLt > highestProcessedLt) {
          highestProcessedLt = txLt;
          lastHash = txHash;
        }
      }

      // Update cursor to highest processed block/lt
      if (highestProcessedLt > lastLt) {
        await this.updateCursor(highestProcessedLt, lastHash);
      }
    } catch (err) {
      console.error('[TonScanner] Error scanning blockchain:', err);
    } finally {
      this.isScanning = false;
    }
  }

  private async processDeposit(
    hash: string,
    lt: number,
    userId: string,
    amount: string,
    senderRaw: string
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Check idempotency: hash already credited?
      const existing = await client.query(
        'SELECT hash FROM te_ton_deposits WHERE hash = $1 FOR UPDATE',
        [hash]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return true; // Already processed
      }

      const rejectDeposit = async (reason: string) => {
        await client.query(
          `INSERT INTO te_ton_deposits (hash, user_id, sender_address, amount, lt, status, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, 'rejected', $6, $7)`,
          [hash, userId, senderRaw, amount, lt, reason, Date.now()]
        );
        await client.query('COMMIT');
        return true;
      };

      // 2. Sender Address Validation (C-04)
      // Check if user has a registered wallet address in te_users
      const userRes = await client.query('SELECT wallet_address FROM te_users WHERE id = $1', [
        userId,
      ]);
      if (userRes.rows.length === 0) {
        console.warn(
          `[TonScanner] Rejected deposit: User ID ${userId} does not exist in exchange records (Tx: ${hash})`
        );
        return await rejectDeposit('User ID does not exist');
      }

      const registeredWallet = userRes.rows[0].wallet_address;
      if (!registeredWallet) {
        console.warn(
          `[TonScanner] Rejected deposit: User ${userId} has no registered wallet address (Tx: ${hash})`
        );
        return await rejectDeposit('User has no registered wallet address');
      }

      // Ensure transaction sender matches authenticated user's wallet address
      const normSender = this.normalizeAddress(senderRaw);
      const normRegistered = this.normalizeAddress(registeredWallet);

      if (!normSender) {
        console.warn(
          `[TonScanner] Rejected deposit: Missing or invalid sender address in tx (Tx: ${hash})`
        );
        return await rejectDeposit('Missing or invalid sender address in tx');
      }
      if (!normRegistered) {
        console.warn(
          `[TonScanner] Rejected deposit: Invalid registered wallet format for user ${userId} (Tx: ${hash})`
        );
        return await rejectDeposit('Invalid registered wallet format');
      }

      if (normSender !== normRegistered) {
        console.error(
          `[TonScanner] SECURITY ALERT: Deposit sender spoofing detected! Tx sender '${normSender}' does not match registered wallet '${normRegistered}' for userId '${userId}' (Tx: ${hash})`
        );
        return await rejectDeposit('Sender address mismatch (Spoofing detected)');
      }

      // 3. Mark deposit as processed
      await client.query(
        'INSERT INTO te_ton_deposits (hash, user_id, sender_address, amount, lt, status, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [hash, userId, senderRaw, amount, lt, 'credited', null, Date.now()]
      );

      // 4. Update user balance atomically
      const balanceRes = await client.query(
        `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, updated_at, created_at)
          VALUES ($1, 'TON', $2, 0, $3, $3)
          ON CONFLICT (user_id, currency)
          DO UPDATE SET
            available_balance = te_balances.available_balance + $2,
            updated_at = $3
          RETURNING available_balance, locked_balance`,
        [userId, amount, Date.now()]
      );

      const newAvail = balanceRes.rows[0].available_balance;
      const newLocked = balanceRes.rows[0].locked_balance;
      const oldAvail = new Decimal(newAvail).minus(new Decimal(amount)).toString();

      // 4.5. Insert Financial Audit
      await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'TON_DEPOSIT',
          userId,
          hash,
          'TON',
          amount,
          oldAvail,
          newAvail,
          newLocked,
          newLocked,
          JSON.stringify({ senderAddress: senderRaw }),
          Date.now(),
        ]
      );

      // 5. Emit outbox event for real-time notification
      await client.query(
        `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          'depositProcessed',
          userId,
          JSON.stringify({ hash, amount, currency: 'TON', timestamp: Date.now() }),
          'pending',
          'TON',
          Date.now(),
        ]
      );

      await client.query('COMMIT');
      console.log(
        `[TonScanner] Successfully credited ${amount} TON to authenticated user ${userId} (Sender: ${senderRaw}, Tx: ${hash.substring(0, 10)}...)`
      );
      return true;
    } catch (e: any) {
      await client.query('ROLLBACK');
      if (e.code === '23505') return true; // Unique violation concurrent skip
      console.error('[TonScanner] Error processing deposit transaction:', e?.message);
      return false;
    } finally {
      client.release();
    }
  }
}
