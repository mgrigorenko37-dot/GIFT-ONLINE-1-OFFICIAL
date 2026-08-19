import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WithdrawalStateMachine,
  WithdrawalTransitionError,
} from './withdrawalStateMachine';

describe('WithdrawalStateMachine Comprehensive Tests', () => {
  let clientMock: any;

  beforeEach(() => {
    clientMock = {
      query: vi.fn(),
      release: vi.fn(),
    };
  });

  it('1. Transition rules definition matches exact specifications', () => {
    // Valid transitions
    expect(WithdrawalStateMachine.isTransitionAllowed('PENDING', 'PROCESSING')).toBe(true);
    expect(WithdrawalStateMachine.isTransitionAllowed('PROCESSING', 'COMPLETED')).toBe(true);
    expect(WithdrawalStateMachine.isTransitionAllowed('PROCESSING', 'FAILED')).toBe(true);
    expect(WithdrawalStateMachine.isTransitionAllowed('PROCESSING', 'RETRYING')).toBe(true);
    expect(WithdrawalStateMachine.isTransitionAllowed('RETRYING', 'PROCESSING')).toBe(true);
    expect(WithdrawalStateMachine.isTransitionAllowed('FAILED', 'PENDING')).toBe(true);

    // Invalid transitions
    expect(WithdrawalStateMachine.isTransitionAllowed('PENDING', 'COMPLETED')).toBe(false);
    expect(WithdrawalStateMachine.isTransitionAllowed('PENDING', 'FAILED')).toBe(false);
    expect(WithdrawalStateMachine.isTransitionAllowed('COMPLETED', 'PENDING')).toBe(false);
    expect(WithdrawalStateMachine.isTransitionAllowed('COMPLETED', 'PROCESSING')).toBe(false);
    expect(WithdrawalStateMachine.isTransitionAllowed('COMPLETED', 'FAILED')).toBe(false);
    expect(WithdrawalStateMachine.isTransitionAllowed('FAILED', 'COMPLETED')).toBe(false);
  });

  it('2. Atomic lockForProcessing: transitions PENDING -> PROCESSING with worker_id and increments attempts', async () => {
    const row = {
      id: 'wd_cas_1',
      user_id: 'u1',
      amount: '5.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      attempts: 0,
      funds_released: false,
      created_at: 1000,
      updated_at: 1000,
    };

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT * FROM te_withdrawals')) {
        return { rows: [row] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        return {
          rows: [
            {
              ...row,
              status: 'PROCESSING',
              worker_id: params[0],
              locked_at: params[1],
              attempts: params[2],
              updated_at: params[1],
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await WithdrawalStateMachine.lockForProcessing(clientMock, 'wd_cas_1', 'worker_alpha', 2000);

    expect(result).toBeDefined();
    expect(result?.status).toBe('PROCESSING');
    expect(result?.worker_id).toBe('worker_alpha');
    expect(result?.attempts).toBe(1);
    expect(result?.locked_at).toBe(2000);
  });

  it('3. COMPLETED without tx_hash throws WithdrawalTransitionError', async () => {
    await expect(
      WithdrawalStateMachine.markCompleted(clientMock, 'wd_1', '', 'worker_alpha')
    ).rejects.toThrow(WithdrawalTransitionError);

    await expect(
      WithdrawalStateMachine.markCompleted(clientMock, 'wd_1', '   ', 'worker_alpha')
    ).rejects.toThrow('Cannot transition to COMPLETED without a valid tx_hash');
  });

  it('4. markCompleted transitions PROCESSING -> COMPLETED and unlocks locked_balance', async () => {
    const row = {
      id: 'wd_comp_1',
      user_id: 'u1',
      amount: '10.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PROCESSING',
      funds_released: false,
      created_at: 1000,
      updated_at: 1000,
    };

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT * FROM te_withdrawals')) {
        return { rows: [row] };
      }
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '50.0', locked_balance: '10.0' }] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
        return {
          rows: [
            {
              ...row,
              status: 'COMPLETED',
              tx_hash: params[0],
              processed_at: params[1],
              updated_at: params[1],
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const result = await WithdrawalStateMachine.markCompleted(
      clientMock,
      'wd_comp_1',
      'ton_tx_real_hash_123',
      'worker_alpha',
      3000
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.tx_hash).toBe('ton_tx_real_hash_123');
    expect(result.processed_at).toBe(3000);

    // Verify balance locked reduction query was executed
    const calls = clientMock.query.mock.calls;
    const balQuery = calls.find((c: any) =>
      c[0].includes('UPDATE te_balances') && c[0].includes('locked_balance = $1')
    );
    expect(balQuery).toBeDefined();
    expect(balQuery[1][0]).toBe('0');
    expect(balQuery[1][2]).toBe('u1');
  });

  it('5. Repeated markCompleted on already COMPLETED record is idempotent and does not error', async () => {
    const completedRow = {
      id: 'wd_already_done',
      user_id: 'u1',
      amount: '10.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'COMPLETED',
      tx_hash: 'existing_hash_999',
      funds_released: false,
      created_at: 1000,
      updated_at: 2000,
    };

    clientMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM te_withdrawals')) {
        return { rows: [completedRow] };
      }
      return { rows: [] };
    });

    const result = await WithdrawalStateMachine.markCompleted(
      clientMock,
      'wd_already_done',
      'existing_hash_999',
      'worker_alpha'
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.tx_hash).toBe('existing_hash_999');
  });

  it('6. markFailed without failure_reason throws WithdrawalTransitionError', async () => {
    await expect(
      WithdrawalStateMachine.markFailed(clientMock, 'wd_fail_1', '', 'worker_alpha')
    ).rejects.toThrow('Cannot transition to FAILED without a valid failure_reason');
  });

  it('7. markFailed refunds balance from locked_balance to available_balance', async () => {
    const row = {
      id: 'wd_fail_refund',
      user_id: 'u2',
      amount: '7.5',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PROCESSING',
      funds_released: false,
      created_at: 1000,
      updated_at: 1000,
    };

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT * FROM te_withdrawals')) {
        return { rows: [row] };
      }
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '20.0', locked_balance: '7.5' }] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes('funds_released = TRUE')) {
        return { rows: [{ ...row, funds_released: true }] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'FAILED'")) {
        return {
          rows: [
            {
              ...row,
              status: 'FAILED',
              failure_reason: params[0],
              processed_at: params[1],
              updated_at: params[1],
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const result = await WithdrawalStateMachine.markFailed(
      clientMock,
      'wd_fail_refund',
      'Network timeout on TON broadcast',
      'worker_beta',
      4000
    );

    expect(result.status).toBe('FAILED');
    expect(result.failure_reason).toBe('Network timeout on TON broadcast');

    // Check balance refund query
    const calls = clientMock.query.mock.calls;
    const refundQuery = calls.find((c: any) =>
      c[0].includes('UPDATE te_balances') && c[0].includes('available_balance = $1')
    );
    expect(refundQuery).toBeDefined();
    expect(refundQuery[1][0]).toBe('27.5'); // 20 + 7.5
    expect(refundQuery[1][1]).toBe('0'); // 7.5 - 7.5
  });

  it('8. retryFailedWithdrawal transitions FAILED -> PENDING and re-locks funds', async () => {
    const failedRow = {
      id: 'wd_retry_1',
      user_id: 'u3',
      amount: '3.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'FAILED',
      failure_reason: 'Previous attempt failed',
      funds_released: true,
      created_at: 1000,
      updated_at: 2000,
    };

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT * FROM te_withdrawals')) {
        return { rows: [failedRow] };
      }
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '10.0', locked_balance: '0.0' }] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PENDING'")) {
        return {
          rows: [
            {
              ...failedRow,
              status: 'PENDING',
              failure_reason: null,
              funds_released: false,
              updated_at: params[0],
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const result = await WithdrawalStateMachine.retryFailedWithdrawal(clientMock, 'wd_retry_1', 5000);

    expect(result.status).toBe('PENDING');
    expect(result.failure_reason).toBeNull();
    expect(result.funds_released).toBe(false);

    // Verify balance re-lock
    const calls = clientMock.query.mock.calls;
    const reLockQuery = calls.find((c: any) =>
      c[0].includes('UPDATE te_balances') && c[0].includes('available_balance = $1')
    );
    expect(reLockQuery).toBeDefined();
    expect(reLockQuery[1][0]).toBe('7'); // 10 - 3
    expect(reLockQuery[1][1]).toBe('3'); // 0 + 3
  });

  it('9. recoverStaleProcessingRecords unlocks hung withdrawals after worker crash', async () => {
    clientMock.query.mockResolvedValue({ rowCount: 3 });

    const recoveredCount = await WithdrawalStateMachine.recoverStaleProcessingRecords(
      clientMock,
      120000,
      1700000200000
    );

    expect(recoveredCount).toBe(3);
    const lastCall = clientMock.query.mock.calls[0];
    expect(lastCall[0]).toContain("status = 'RETRYING'");
    expect(lastCall[0]).toContain("WHERE status = 'PROCESSING'");
  });
});
