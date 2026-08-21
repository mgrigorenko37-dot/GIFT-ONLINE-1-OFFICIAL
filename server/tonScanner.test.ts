import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TonScanner } from './tonScanner';
import Decimal from 'decimal.js';

describe('TonScanner Production Tests', () => {
  let mockPool: any;
  let mockClient: any;
  let scanner: TonScanner;
  let queries: any[] = [];
  let fetchMock: any;

  const validAddress = '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8';
  const spoofAddress = '0:1111111111111111111111111111111111111111111111111111111111111111';

  beforeEach(() => {
    queries = [];
    mockClient = {
      query: vi.fn(async (text, params) => {
        queries.push({ text, params });
        
        if (text.includes('SELECT last_lt')) return { rows: [{ last_lt: '100' }] };
        if (text.includes('SELECT hash FROM te_ton_deposits WHERE hash = $1 FOR UPDATE')) {
           // We will mock this specifically in tests if needed
           return { rowCount: 0 };
        }
        if (text.includes('SELECT wallet_address')) return { rows: [{ wallet_address: validAddress }] };
        if (text.includes('RETURNING available_balance')) return { rows: [{ available_balance: '100', locked_balance: '0' }] };
        
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(async (text, params) => {
        queries.push({ text, params });
        if (text.includes('SELECT last_lt')) return { rows: [{ last_lt: '100' }] };
        return { rowCount: 1, rows: [] };
      }),
    };

    scanner = new TonScanner(mockPool);
    
    process.env.EXCHANGE_HOT_WALLET_ADDRESS = '0:hotwallet';
    
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockTransactions = (txs: any[]) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ transactions: txs }),
    });
  };

  const createTx = (lt: number, hash: string, value: string, text: string, source: string) => ({
    lt,
    hash,
    in_msg: {
      value,
      source: { address: source },
      decoded_op_name: 'text_comment',
      decoded_body: { text },
    }
  });

  it('1. should process valid deposit, update cursor, credit balance, and emit event', async () => {
    mockTransactions([
      createTx(101, 'hash1', '1000000000', 'Deposit_user1', validAddress),
    ]);
    
    await (scanner as any).scan();
    
    const commits = queries.filter(q => q.text === 'COMMIT');
    expect(commits.length).toBe(1);
    
    const depositInsert = queries.find(q => q.text.includes('INSERT INTO te_ton_deposits') && q.params && q.params[5] === 'credited');
    expect(depositInsert).toBeDefined();
    expect(depositInsert.params[3]).toBe('1'); // amount 1 TON

    const cursorUpdate = queries.find(q => q.text.includes('INSERT INTO te_ton_scanner_cursor'));
    expect(cursorUpdate).toBeDefined();
    expect(cursorUpdate.params[0]).toBe(101); // highest lt
  });

  it('2. should reject duplicate transactions without crediting balance again', async () => {
    // Override the mock to return an existing transaction
    mockClient.query = vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (text.includes('SELECT hash FROM te_ton_deposits WHERE hash = $1 FOR UPDATE')) {
         return { rowCount: 1, rows: [{ hash: 'hash_dup' }] };
      }
      return { rowCount: 1, rows: [] };
    });

    mockTransactions([
      createTx(102, 'hash_dup', '1000000000', 'Deposit_user1', validAddress),
    ]);

    await (scanner as any).scan();

    const commits = queries.filter(q => q.text === 'COMMIT');
    expect(commits.length).toBe(0); // Because it rolls back and skips

    const balanceUpdate = queries.find(q => q.text.includes('INSERT INTO te_balances'));
    expect(balanceUpdate).toBeUndefined(); // Balance should not update

    const cursorUpdate = queries.find(q => q.text.includes('INSERT INTO te_ton_scanner_cursor'));
    expect(cursorUpdate).toBeDefined();
    expect(cursorUpdate.params[0]).toBe(102); // LT still advanced!
  });

  it('3. should reject deposit from spoofed sender (sender != registered wallet)', async () => {
    mockTransactions([
      createTx(103, 'hash_spoof', '1000000000', 'Deposit_user1', spoofAddress),
    ]);

    await (scanner as any).scan();

    const commits = queries.filter(q => q.text === 'COMMIT');
    expect(commits.length).toBe(1); // the rejectDeposit commits the rejection!

    const depositInsert = queries.find(q => q.text.includes('INSERT INTO te_ton_deposits') && q.params && q.text.includes('rejected'));
    expect(depositInsert).toBeDefined();
    expect(depositInsert.params[5]).toContain('mismatch');

    const balanceUpdate = queries.find(q => q.text.includes('INSERT INTO te_balances'));
    expect(balanceUpdate).toBeUndefined(); // Balance should not update

    const cursorUpdate = queries.find(q => q.text.includes('INSERT INTO te_ton_scanner_cursor'));
    expect(cursorUpdate).toBeDefined();
    expect(cursorUpdate.params[0]).toBe(103); // LT advanced!
  });

  it('4. should NOT silently skip deposit or update cursor if DB crashes on one transaction', async () => {
    mockTransactions([
      createTx(104, 'hash_fail', '1000000000', 'Deposit_user1', validAddress),
      createTx(105, 'hash_ok', '1000000000', 'Deposit_user1', validAddress),
    ]);

    // Simulate DB error during processing 104
    mockClient.query = vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (text.includes('SELECT hash FROM te_ton_deposits')) {
         if (params[0] === 'hash_fail') throw new Error('DB Deadlock or crash');
         return { rowCount: 0 };
      }
      if (text.includes('SELECT wallet_address')) return { rows: [{ wallet_address: validAddress }] };
      if (text.includes('RETURNING available_balance')) return { rows: [{ available_balance: '100', locked_balance: '0' }] };
      return { rowCount: 1, rows: [] };
    });

    await (scanner as any).scan();

    // Loop should break on hash_fail, so hash_ok is never processed!
    const hashOkQuery = queries.find(q => q.text.includes('hash_ok'));
    expect(hashOkQuery).toBeUndefined();

    const cursorUpdate = queries.find(q => q.text.includes('INSERT INTO te_ton_scanner_cursor'));
    expect(cursorUpdate).toBeUndefined(); // Cursor should NOT update because NO transactions succeeded above 100
  });

  it('5. should process amounts correctly without decimal precision loss', async () => {
    mockTransactions([
      createTx(106, 'hash_decimals', '1234567890', 'Deposit_user1', validAddress), // 1.23456789 TON
    ]);

    await (scanner as any).scan();

    const depositInsert = queries.find(q => q.text.includes('INSERT INTO te_ton_deposits') && q.params && q.params[5] === 'credited');
    expect(depositInsert).toBeDefined();
    expect(depositInsert.params[3]).toBe('1.23456789'); // Validated string format
  });

  it('6. should reject deposit if user not found', async () => {
    mockClient.query = vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (text.includes('SELECT hash FROM te_ton_deposits')) return { rowCount: 0 };
      if (text.includes('SELECT wallet_address')) return { rows: [] }; // User not found
      return { rowCount: 1, rows: [] };
    });

    mockTransactions([
      createTx(107, 'hash_no_user', '1000000000', 'Deposit_unknown', validAddress),
    ]);

    await (scanner as any).scan();

    const depositInsert = queries.find(q => q.text.includes('INSERT INTO te_ton_deposits') && q.params && q.text.includes('rejected'));
    expect(depositInsert).toBeDefined();
    expect(depositInsert.params[5]).toContain('User ID does not exist');
  });

  it('7. should resume normally if valid deposit follows successfully processed deposit', async () => {
    mockTransactions([
      createTx(108, 'hash_first', '1000000000', 'Deposit_user1', validAddress),
      createTx(109, 'hash_second', '1000000000', 'Deposit_user1', validAddress),
    ]);

    await (scanner as any).scan();

    const depositInserts = queries.filter(q => q.text.includes('INSERT INTO te_ton_deposits') && q.params && q.params[5] === 'credited');
    expect(depositInserts.length).toBe(2);

    const cursorUpdate = queries.find(q => q.text.includes('INSERT INTO te_ton_scanner_cursor'));
    expect(cursorUpdate).toBeDefined();
    expect(cursorUpdate.params[0]).toBe(109); // Cursor updated to the highest successful LT
  });
});
