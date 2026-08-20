import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { WithdrawalWorker } from './withdrawalWorker';
import { MockTonTransferAdapter } from './tonAdapter';

describe('WithdrawalWorker & TON Transfer Integration', () => {
  let mockPool: any;
  let clientMock: any;
  let mockAdapter: MockTonTransferAdapter;

  beforeEach(() => {
    mockAdapter = new MockTonTransferAdapter();

    clientMock = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(clientMock),
    } as unknown as Pool;
  });

  it('1. Successful withdrawal transfer flow updates state and locked balance correctly', async () => {
    const pendingWithdrawal = {
      id: 'wd_12345',
      user_id: 'user_ton_1',
      amount: '2.5',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      attempts: 0,
      next_attempt_at: null,
      funds_released: false,
      created_at: 1700000000000,
      updated_at: 1700000000000,
    };

    let selectCalled = false;
    let currentStatus = 'PENDING';

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

      // Recovery of stale records
      if (sql.includes("WHERE status = 'PROCESSING'") && sql.includes('locked_at <')) {
        return { rowCount: 0, rows: [] };
      }

      // SELECT FOR UPDATE SKIP LOCKED
      if (
        sql.includes('SELECT id FROM te_withdrawals') &&
        sql.includes("status IN ('PENDING', 'RETRYING')")
      ) {
        if (!selectCalled) {
          selectCalled = true;
          return { rows: [{ id: pendingWithdrawal.id }] };
        }
        return { rows: [] };
      }

      // UPDATE te_withdrawals SET status = 'PROCESSING'
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        currentStatus = 'PROCESSING';
        return {
          rows: [
            {
              ...pendingWithdrawal,
              status: 'PROCESSING',
              worker_id: params[0],
              locked_at: params[1],
              attempts: 1,
              updated_at: params[1],
            },
          ],
        };
      }

      // Single item SELECT FOR UPDATE during markCompleted
      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [
            {
              ...pendingWithdrawal,
              status: currentStatus,
              attempts: 1,
            },
          ],
        };
      }

      // Balance check during markCompleted
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '10.0', locked_balance: '2.5' }] };
      }

      // markCompleted UPDATE
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
        currentStatus = 'COMPLETED';
        return {
          rows: [
            {
              ...pendingWithdrawal,
              status: 'COMPLETED',
              tx_hash: params[0],
              processed_at: params[1],
              updated_at: params[1],
            },
          ],
        };
      }

      if (
        sql.includes('UPDATE te_balances') ||
        sql.includes('INSERT INTO te_outbox_events') ||
        sql.includes('UPDATE te_outbox_events') ||
        sql.includes('INSERT INTO te_financial_audits')
      ) {
        return { rowCount: 1, rows: [] };
      }

      return { rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, {
      intervalMs: 10000,
      batchSize: 5,
      adapter: mockAdapter,
    });

    const processed = await worker.processPendingWithdrawals();

    expect(processed).toBe(1);
    expect(mockAdapter.sentTransfers.length).toBe(1);
    expect(mockAdapter.sentTransfers[0].to).toBe(pendingWithdrawal.address);
    expect(mockAdapter.sentTransfers[0].amount).toBe('2.5');

    // Verify SQL updates: status COMPLETED
    const calls = clientMock.query.mock.calls;
    const completedUpdate = calls.find(
      (c: any) => c[0].includes('UPDATE te_withdrawals') && c[0].includes("status = 'COMPLETED'")
    );
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate[1][0]).toMatch(/^mock_tx_/);
    expect(completedUpdate[1][2]).toBe('wd_12345');

    const balanceUpdate = calls.find(
      (c: any) => c[0].includes('UPDATE te_balances') && c[0].includes('locked_balance = $1')
    );
    expect(balanceUpdate).toBeDefined();
  });

  it('2. TON provider error sets withdrawal to RETRYING or FAILED', async () => {
    mockAdapter.shouldFail = true;
    mockAdapter.failureMessage = 'TON Node connection timeout (504 Gateway Timeout)';

    const pendingWithdrawal = {
      id: 'wd_fail_999',
      user_id: 'user_ton_2',
      amount: '5.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      attempts: 0,
      next_attempt_at: null,
      funds_released: false,
      created_at: 1700000000000,
      updated_at: 1700000000000,
    };

    let selectCalled = false;
    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

      if (
        sql.includes('SELECT id FROM te_withdrawals') &&
        sql.includes("status IN ('PENDING', 'RETRYING')")
      ) {
        if (!selectCalled) {
          selectCalled = true;
          return { rows: [{ id: pendingWithdrawal.id }] };
        }
        return { rows: [] };
      }

      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        return {
          rows: [
            {
              ...pendingWithdrawal,
              status: 'PROCESSING',
              worker_id: params[0],
              locked_at: params[1],
              attempts: 1,
              updated_at: params[1],
            },
          ],
        };
      }

      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [{ ...pendingWithdrawal, status: 'PROCESSING', attempts: 1 }],
        };
      }

      if (sql.includes('UPDATE te_withdrawals')) {
        return { rows: [{ ...pendingWithdrawal, status: 'RETRYING' }], rowCount: 1 };
      }

      return { rowCount: 1, rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, {
      intervalMs: 10000,
      batchSize: 5,
      adapter: mockAdapter,
    });

    const processed = await worker.processPendingWithdrawals();

    expect(processed).toBe(1);

    // Verify RETRYING transition was initiated
    const calls = clientMock.query.mock.calls;
    const retryingUpdate = calls.find(
      (c: any) => c[0].includes('UPDATE te_withdrawals') && c[0].includes("status = 'RETRYING'")
    );
    expect(retryingUpdate).toBeDefined();
    expect(retryingUpdate[1][0]).toBe('TON Node connection timeout (504 Gateway Timeout)');
  });

  it('3. Repeated worker execution is safe and idempotent (No double-spend)', async () => {
    let callCount = 0;
    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

      if (
        sql.includes('SELECT id FROM te_withdrawals') &&
        sql.includes("status IN ('PENDING', 'RETRYING')")
      ) {
        callCount++;
        if (callCount === 1) {
          return { rows: [{ id: 'wd_idempotent' }] };
        }
        return { rows: [] };
      }

      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        return {
          rows: [
            {
              id: 'wd_idempotent',
              operation_id: 'op_wd_idempotent',
              user_id: 'user_1',
              amount: '1.0',
              currency: 'TON',
              address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
              status: 'PROCESSING',
              attempts: 1,
              funds_released: false,
              created_at: 1000,
              updated_at: 1000,
            },
          ],
        };
      }

      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [
            {
              id: 'wd_idempotent',
              user_id: 'user_1',
              amount: '1.0',
              currency: 'TON',
              address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
              status: 'PROCESSING',
              attempts: 1,
              funds_released: false,
              created_at: 1000,
              updated_at: 1000,
            },
          ],
        };
      }

      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '10.0', locked_balance: '1.0' }] };
      }

      if (sql.includes('UPDATE te_withdrawals')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'wd_idempotent',
              operation_id: 'op_wd_idempotent',
              user_id: 'user_1',
              amount: '1.0',
              currency: 'TON',
              address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
              status: 'COMPLETED',
              attempts: 1,
              funds_released: false,
              created_at: 1000,
              updated_at: 1000,
            },
          ],
        };
      }

      if (
        sql.includes('UPDATE te_balances') ||
        sql.includes('INSERT INTO te_outbox_events') ||
        sql.includes('UPDATE te_outbox_events') ||
        sql.includes('INSERT INTO te_financial_audits')
      ) {
        return { rowCount: 1, rows: [] };
      }

      return { rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, {
      intervalMs: 10000,
      adapter: mockAdapter,
    });

    const run1 = await worker.processPendingWithdrawals();
    const run2 = await worker.processPendingWithdrawals();

    expect(run1).toBe(1);
    expect(run2).toBe(0);
    expect(mockAdapter.sentTransfers.length).toBe(1); // exactly 1 on-chain transfer executed
  });

  it('4. Concurrent execution by multiple worker instances prevents duplicate processing via row locks', async () => {
    const row1 = {
      id: 'wd_concurrent_1',
      user_id: 'u1',
      amount: '10',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      attempts: 0,
      funds_released: false,
      created_at: 1000,
      updated_at: 1000,
    };
    const row2 = {
      id: 'wd_concurrent_2',
      user_id: 'u2',
      amount: '20',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      attempts: 0,
      funds_released: false,
      created_at: 1001,
      updated_at: 1001,
    };

    let instance1Called = false;
    let instance2Called = false;

    const clientMock1: any = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id FROM te_withdrawals')) {
          if (!instance1Called) {
            instance1Called = true;
            return { rows: [{ id: row1.id }] };
          }
          return { rows: [] };
        }
        if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
          return {
            rows: [
              {
                ...row1,
                operation_id: 'op_' + row1.id,
                status: 'PROCESSING',
                worker_id: params[0],
                attempts: 1,
              },
            ],
          };
        }
        if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
          return {
            rows: [
              { ...row1, operation_id: 'op_' + row1.id, status: 'COMPLETED', tx_hash: params[0] },
            ],
          };
        }
        if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...row1, status: 'PROCESSING', attempts: 1 }] };
        }
        if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
          return { rows: [{ available_balance: '100.0', locked_balance: '10.0' }] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };

    const clientMock2: any = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id FROM te_withdrawals')) {
          if (!instance2Called) {
            instance2Called = true;
            return { rows: [{ id: row2.id }] }; // Skips row 1
          }
          return { rows: [] };
        }
        if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
          return {
            rows: [
              {
                ...row2,
                operation_id: 'op_' + row2.id,
                status: 'PROCESSING',
                worker_id: params[0],
                attempts: 1,
              },
            ],
          };
        }
        if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
          return {
            rows: [
              { ...row2, operation_id: 'op_' + row2.id, status: 'COMPLETED', tx_hash: params[0] },
            ],
          };
        }
        if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...row2, status: 'PROCESSING', attempts: 1 }] };
        }
        if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
          return { rows: [{ available_balance: '100.0', locked_balance: '20.0' }] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };

    const pool1 = { connect: vi.fn().mockResolvedValue(clientMock1) } as unknown as Pool;
    const pool2 = { connect: vi.fn().mockResolvedValue(clientMock2) } as unknown as Pool;

    const worker1 = new WithdrawalWorker(pool1, { adapter: mockAdapter, workerId: 'worker_1' });
    const worker2 = new WithdrawalWorker(pool2, { adapter: mockAdapter, workerId: 'worker_2' });

    const [res1, res2] = await Promise.all([
      worker1.processPendingWithdrawals(),
      worker2.processPendingWithdrawals(),
    ]);

    expect(res1).toBe(1);
    expect(res2).toBe(1);
    expect(mockAdapter.sentTransfers.length).toBe(2);
    expect(mockAdapter.sentTransfers.map((t) => t.amount).sort()).toEqual(['10', '20']);
  });
});
