import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { TonScanner } from '../../server/tonScanner';
import { getTestDbPool, seedTestUser, cleanupUserData } from './postgresFixture';

describe('TON Scanner Deposit Flow (PostgreSQL)', () => {
  let pool: Pool;
  let scanner: any;
  const userId = 'user_ton_123';
  const walletAddress = 'EQValidSender123';

  beforeAll(async () => {
    pool = await getTestDbPool();
    scanner = new TonScanner(pool);
  });

  beforeEach(async () => {
    await cleanupUserData(pool, userId);
    await pool.query('TRUNCATE te_ton_scanner_cursor, te_ton_deposits RESTART IDENTITY;');
    await seedTestUser(pool, userId, walletAddress, { TON: 0 });
  });

  afterAll(async () => {
    await cleanupUserData(pool, userId);
  });

  it('1. Valid sender credits balance and creates outbox event', async () => {
    await scanner.processDeposit('hash1', 1000, userId, 5.5, walletAddress);
    const balance = await pool.query("SELECT available_balance FROM te_balances WHERE user_id=$1 AND currency='TON'", [userId]);
    expect(Number(balance.rows[0].available_balance)).toBe(5.5);
    const deposits = await pool.query("SELECT * FROM te_ton_deposits WHERE hash='hash1'");
    expect(deposits.rowCount).toBe(1);
    const outbox = await pool.query("SELECT * FROM te_outbox_events WHERE user_id=$1", [userId]);
    expect(outbox.rowCount).toBe(1);
    expect(outbox.rows[0].event_type).toBe('depositProcessed');
  });

  it('2. Unknown or mismatched sender rolls back transaction and does NOT credit balance', async () => {
    await scanner.processDeposit('hash2', 1001, userId, 2.0, 'EQHackerAddress999');
    const balance = await pool.query("SELECT available_balance FROM te_balances WHERE user_id=$1 AND currency='TON'", [userId]);
    expect(Number(balance.rows[0].available_balance)).toBe(0);
    const deposits = await pool.query("SELECT * FROM te_ton_deposits WHERE hash='hash2'");
    expect(deposits.rowCount).toBe(0);
  });

  it('3. Duplicate transaction hash is rejected', async () => {
    await scanner.processDeposit('hash_dup', 1002, userId, 10, walletAddress);
    await scanner.processDeposit('hash_dup', 1002, userId, 10, walletAddress); // Should fail/skip cleanly
    const balance = await pool.query("SELECT available_balance FROM te_balances WHERE user_id=$1 AND currency='TON'", [userId]);
    expect(Number(balance.rows[0].available_balance)).toBe(10);
    const deposits = await pool.query("SELECT * FROM te_ton_deposits WHERE hash='hash_dup'");
    expect(deposits.rowCount).toBe(1); // Only 1 inserted
  });

  it('4. Repeated or stale scan cursor updates correctly', async () => {
    await scanner.updateCursor(500, 'hashA');
    let c = await scanner.getCursor();
    expect(c).toBe(500);

    // Update with lower LT should NOT decrease cursor
    await scanner.updateCursor(400, 'hashB');
    c = await scanner.getCursor();
    expect(c).toBe(500); // Still 500

    // Update with higher LT
    await scanner.updateCursor(600, 'hashC');
    c = await scanner.getCursor();
    expect(c).toBe(600);
  });

  it('5. Corrupted or incomplete blockchain events are ignored', async () => {
    // This is tested in scan() via API fetch. We can simulate it by hacking fetch
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        transactions: [
          { hash: 'corrupt1', lt: 700 }, // No in_msg
          { hash: 'corrupt2', lt: 701, in_msg: {} }, // No value
          { hash: 'valid3', lt: 702, in_msg: { value: '1000000000', decoded_op_name: 'text_comment', decoded_body: { text: `Deposit_${userId}` }, source: walletAddress } }
        ]
      })
    }) as any;
    
    process.env.EXCHANGE_HOT_WALLET_ADDRESS = 'HOT123';
    await scanner.updateCursor(600, 'hashC');
    await scanner.scan();
    
    const balance = await pool.query("SELECT available_balance FROM te_balances WHERE user_id=$1 AND currency='TON'", [userId]);
    expect(Number(balance.rows[0].available_balance)).toBe(1); // 1 TON credited from valid3
    const c = await scanner.getCursor();
    expect(c).toBe(702); // Advanced to highest
  });
});
