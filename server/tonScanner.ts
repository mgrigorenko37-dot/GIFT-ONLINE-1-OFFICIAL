import { Pool } from 'pg';

export class TonScanner {
  private pool: Pool;
  private intervalId: NodeJS.Timeout | null = null;
  private lastProcessedHash: string | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  public start() {
    console.log('[TonScanner] Starting background scanner...');
    this.intervalId = setInterval(() => this.scan(), 10000); // Check every 10 seconds
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private async scan() {
    const address = process.env.EXCHANGE_HOT_WALLET_ADDRESS;
    // For demo purposes, if not set, we can just skip or listen to a known testnet address.
    // Here we'll just log once and skip if not configured.
    if (!address) {
      // console.warn('[TonScanner] EXCHANGE_HOT_WALLET_ADDRESS not set. Scanner inactive.');
      return;
    }

    try {
      const res = await fetch(`https://tonapi.io/v2/blockchain/accounts/${address}/transactions?limit=20`);
      if (!res.ok) return;
      const data = await res.json();
      
      if (!data.transactions || !Array.isArray(data.transactions)) return;

      // Transactions are typically ordered newest first. We iterate from oldest to newest in the chunk
      // Or just check each.
      for (const tx of data.transactions) {
        // Skip if there are no incoming messages
        if (!tx.in_msg) continue;
        
        const msg = tx.in_msg;
        
        // We only care about incoming internal transfers with a value
        if (msg.value && msg.decoded_op_name === 'text_comment' && msg.decoded_body && msg.decoded_body.text) {
          const text = msg.decoded_body.text as string;
          if (text.startsWith('Deposit_')) {
            const userId = text.split('_')[1];
            const amount = Number(msg.value) / 1e9;
            const hash = tx.hash;

            await this.processDeposit(hash, userId, amount);
          }
        }
      }
    } catch(err) {
      console.error('[TonScanner] Error fetching transactions:', err);
    }
  }
  
  private async processDeposit(hash: string, userId: string, amount: number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check if already processed
      const res = await client.query('SELECT hash FROM te_ton_deposits WHERE hash = $1', [hash]);
      if (res.rowCount && res.rowCount > 0) {
        await client.query('ROLLBACK');
        return; // Already processed
      }
      
      // Mark as processed
      await client.query('INSERT INTO te_ton_deposits (hash, user_id, amount, created_at) VALUES ($1, $2, $3, $4)', [hash, userId, amount, Date.now()]);
      
      // Update user balance
      await client.query(`
        INSERT INTO te_balances (user_id, currency, available_balance, updated_at) 
        VALUES ($1, 'TON', $2, $3) 
        ON CONFLICT (user_id, currency) 
        DO UPDATE SET 
          available_balance = te_balances.available_balance + $2, 
          updated_at = $3
      `, [userId, amount, Date.now()]);
      
      await client.query('COMMIT');
      console.log(`[TonScanner] Processed incoming deposit of ${amount} TON for user ${userId} (Tx: ${hash.substring(0,8)}...)`);
    } catch(e: any) {
      await client.query('ROLLBACK');
      // If it's a unique violation, another instance might have processed it
      if (e.code === '23505') {
        return;
      }
      console.error('[TonScanner] Error processing deposit:', e?.message);
    } finally {
      client.release();
    }
  }
}
