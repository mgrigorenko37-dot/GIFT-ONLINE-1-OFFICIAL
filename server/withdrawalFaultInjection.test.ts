import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { WithdrawalWorker } from './withdrawalWorker';
import { MockTonTransferAdapter, TonTransferAdapter } from './tonAdapter';
import { WithdrawalStateMachine, WithdrawalTransitionError } from './withdrawalStateMachine';

/**
 * Fault-injection TonTransferAdapter to simulate specific network & adapter failure modes
 */
class FaultInjectionTonAdapter extends MockTonTransferAdapter {
  public checkTransactionError: Error | null = null;
  public sendTonError: Error | null = null;

  async checkTransactionByOperationId(
    operationId: string,
    destinationAddress?: string
  ): Promise<{ found: boolean; txHash?: string }> {
    if (this.checkTransactionError) {
      throw this.checkTransactionError;
    }
    return super.checkTransactionByOperationId(operationId, destinationAddress);
  }

  async sendTon(
    destinationAddress: string,
    amountTon: any,
    memo?: string,
    operationId?: string
  ): Promise<any> {
    if (this.sendTonError) {
      throw this.sendTonError;
    }
    return super.sendTon(destinationAddress, amountTon, memo, operationId);
  }
}

describe('Withdrawal Worker & State Machine Fault Injection & Edge-Case Tests', () => {
  let mockPool: any;
  let clientMock: any;
  let adapter: FaultInjectionTonAdapter;

  beforeEach(() => {
    adapter = new FaultInjectionTonAdapter();
    clientMock = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(clientMock),
    } as unknown as Pool;
  });

  it('1. Crash after broadcast: on-chain tx exists, worker reconciles txHash and completes without double broadcast', async () => {
    const withdrawal = {
      id: 'wd_crash_001',
      operation_id: 'op_wd_crash_001',
      user_id: 'u_crash',
      amount: '5.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'RETRYING',
      tx_hash: null,
      attempts: 1,
      next_attempt_at: null,
      funds_released: false,
      created_at: Date.now() - 60000,
      updated_at: Date.now() - 60000,
    };

    adapter.publishedTxByOpId.set('op_wd_crash_001', 'tx_on_chain_999');

    let locked = false;
    let currentStatus = 'RETRYING';
    let savedTxHash: string | null = null;

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes("WHERE status = 'PROCESSING'") && sql.includes('locked_at <')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id FROM te_withdrawals')) {
        if (!locked) {
          locked = true;
          return { rows: [{ id: withdrawal.id }] };
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        currentStatus = 'PROCESSING';
        return {
          rows: [
            {
              ...withdrawal,
              status: 'PROCESSING',
              worker_id: params[0],
              locked_at: params[1],
            },
          ],
        };
      }
      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ ...withdrawal, status: currentStatus }] };
      }
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '10.0', locked_balance: '5.0' }] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
        currentStatus = 'COMPLETED';
        savedTxHash = params[0];
        return { rows: [{ ...withdrawal, status: 'COMPLETED', tx_hash: savedTxHash }] };
      }
      return { rowCount: 1, rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, { adapter, workerId: 'w_crash_test' });
    await worker.processPendingWithdrawals();

    expect(adapter.sentTransfers.length).toBe(0); // ZERO re-broadcasts
    expect(currentStatus).toBe('COMPLETED');
    expect(savedTxHash).toBe('tx_on_chain_999');
  });

  it('2. Timeout after broadcast (unknown outcome): transitions to NEEDS_RECONCILIATION without retry or refund', async () => {
    adapter.shouldFail = true;
    adapter.isTimeout = true;
    adapter.failureMessage = 'Gateway timeout (504)';

    const withdrawal = {
      id: 'wd_timeout_002',
      operation_id: 'op_wd_timeout_002',
      user_id: 'u_timeout',
      amount: '2.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      tx_hash: null,
      attempts: 0,
      funds_released: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    let locked = false;
    let finalStatus = 'PENDING';

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM te_withdrawals')) {
        if (!locked) {
          locked = true;
          return { rows: [{ id: withdrawal.id }] };
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        return {
          rows: [
            {
              ...withdrawal,
              status: 'PROCESSING',
              attempts: 1,
            },
          ],
        };
      }
      if (
        sql.includes('UPDATE te_withdrawals') &&
        sql.includes("status = 'NEEDS_RECONCILIATION'")
      ) {
        finalStatus = 'NEEDS_RECONCILIATION';
        return {
          rows: [{ ...withdrawal, status: 'NEEDS_RECONCILIATION', failure_reason: params[0] }],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, { adapter, workerId: 'w_timeout_test' });
    await worker.processPendingWithdrawals();

    expect(finalStatus).toBe('NEEDS_RECONCILIATION');
  });

  it('3. Repeated worker execution: sequential cycles do not re-process completed withdrawals', async () => {
    const worker = new WithdrawalWorker(mockPool, { adapter, workerId: 'w_repeat' });

    clientMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM te_withdrawals')) {
        return { rows: [] }; // No pending records
      }
      return { rowCount: 0, rows: [] };
    });

    const count1 = await worker.processPendingWithdrawals();
    const count2 = await worker.processPendingWithdrawals();

    expect(count1).toBe(0);
    expect(count2).toBe(0);
    expect(adapter.sentTransfers.length).toBe(0);
  });

  it('4. Stale PROCESSING recovery: recovers hung locks after worker crash', async () => {
    clientMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'RETRYING'") && sql.includes("WHERE status = 'PROCESSING'")) {
        return { rowCount: 2 };
      }
      return { rowCount: 0, rows: [] };
    });

    const recovered = await WithdrawalStateMachine.recoverStaleProcessingRecords(
      clientMock,
      120000,
      Date.now()
    );
    expect(recovered).toBe(2);
  });

  it('5. Duplicate markCompleted: calling markCompleted twice is idempotent and does not reduce locked_balance twice', async () => {
    const completedRow = {
      id: 'wd_dup_completed',
      user_id: 'u_dup',
      amount: '10.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'COMPLETED',
      tx_hash: 'tx_first_call_hash',
      funds_released: false,
      created_at: Date.now() - 10000,
      updated_at: Date.now() - 5000,
    };

    clientMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return { rows: [completedRow] };
      }
      return { rows: [] };
    });

    const res1 = await WithdrawalStateMachine.markCompleted(
      clientMock,
      'wd_dup_completed',
      'tx_first_call_hash',
      'w_1'
    );
    const res2 = await WithdrawalStateMachine.markCompleted(
      clientMock,
      'wd_dup_completed',
      'tx_first_call_hash',
      'w_1'
    );

    expect(res1.status).toBe('COMPLETED');
    expect(res2.status).toBe('COMPLETED');
    // Ensure UPDATE te_balances was NOT called in second markCompleted
    const balanceUpdates = clientMock.query.mock.calls.filter((c: any) =>
      c[0].includes('UPDATE te_balances')
    );
    expect(balanceUpdates.length).toBe(0);
  });

  it('6. Duplicate releaseWithdrawalFunds: calling releaseWithdrawalFunds twice only credits available_balance once', async () => {
    const failedRow = {
      id: 'wd_dup_release',
      user_id: 'u_release',
      amount: '5.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'FAILED',
      funds_released: false,
      created_at: Date.now() - 10000,
      updated_at: Date.now() - 5000,
    };

    let fundsReleasedInDb = false;

    clientMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ ...failedRow, funds_released: fundsReleasedInDb }] };
      }
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '10.0', locked_balance: '5.0' }] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes('funds_released = TRUE')) {
        fundsReleasedInDb = true;
        return { rows: [{ ...failedRow, funds_released: true }] };
      }
      return { rowCount: 1, rows: [] };
    });

    const rel1 = await WithdrawalStateMachine.releaseWithdrawalFunds(
      clientMock,
      'wd_dup_release',
      'First failure',
      'w_1'
    );
    const rel2 = await WithdrawalStateMachine.releaseWithdrawalFunds(
      clientMock,
      'wd_dup_release',
      'Duplicate failure call',
      'w_1'
    );

    expect(rel1.released).toBe(true);
    expect(rel2.released).toBe(false); // Second call is a safe no-op
  });

  it('7. Reconciliation of found transaction: markCompleted transitions NEEDS_RECONCILIATION -> COMPLETED', async () => {
    const reconRow = {
      id: 'wd_needs_recon_1',
      user_id: 'u_recon',
      amount: '4.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'NEEDS_RECONCILIATION',
      funds_released: false,
      created_at: Date.now() - 20000,
      updated_at: Date.now() - 10000,
    };

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return { rows: [reconRow] };
      }
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '15.0', locked_balance: '4.0' }] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
        return {
          rows: [
            {
              ...reconRow,
              status: 'COMPLETED',
              tx_hash: params[0],
              processed_at: params[1],
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const res = await WithdrawalStateMachine.markCompleted(
      clientMock,
      'wd_needs_recon_1',
      'tx_reconciled_hash_777',
      'w_recon'
    );

    expect(res.status).toBe('COMPLETED');
    expect(res.tx_hash).toBe('tx_reconciled_hash_777');
  });

  it('8. Reconciliation unavailable: when checkTransactionByOperationId throws on retry, worker MUST NOT re-broadcast', async () => {
    adapter.checkTransactionError = new Error('RPC endpoint unavailable (503 Service Unavailable)');

    const retryWithdrawal = {
      id: 'wd_recon_down_008',
      operation_id: 'op_wd_recon_down_008',
      user_id: 'u_recon_down',
      amount: '8.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'RETRYING',
      tx_hash: null,
      attempts: 2, // RETRY ATTEMPT!
      funds_released: false,
      created_at: Date.now() - 30000,
      updated_at: Date.now() - 10000,
    };

    let locked = false;
    let updatedStatus = 'RETRYING';

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM te_withdrawals')) {
        if (!locked) {
          locked = true;
          return { rows: [{ id: retryWithdrawal.id }] };
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        return {
          rows: [
            {
              ...retryWithdrawal,
              status: 'PROCESSING',
              attempts: 2,
            },
          ],
        };
      }
      if (
        sql.includes('UPDATE te_withdrawals') &&
        sql.includes("status = 'NEEDS_RECONCILIATION'")
      ) {
        updatedStatus = 'NEEDS_RECONCILIATION';
        return {
          rows: [
            {
              ...retryWithdrawal,
              status: 'NEEDS_RECONCILIATION',
              failure_reason: params[0],
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, { adapter, workerId: 'w_recon_down' });
    await worker.processPendingWithdrawals();

    // CRITICAL: sendTon MUST NOT be called!
    expect(adapter.sentTransfers.length).toBe(0);
    expect(updatedStatus).toBe('NEEDS_RECONCILIATION');
  });

  it('9. Two workers on one withdrawal: FOR UPDATE SKIP LOCKED prevents duplicate processing', async () => {
    const withdrawal = {
      id: 'wd_concurrent_009',
      operation_id: 'op_wd_concurrent_009',
      user_id: 'u_conc',
      amount: '1.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      tx_hash: null,
      attempts: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    let worker1Locked = false;

    // Simulate Worker 1 getting the row, Worker 2 getting zero rows due to SKIP LOCKED
    const clientWorker1 = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id FROM te_withdrawals')) {
          if (!worker1Locked) {
            worker1Locked = true;
            return { rows: [{ id: withdrawal.id }] };
          }
          return { rows: [] };
        }
        if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
          return {
            rows: [
              {
                ...withdrawal,
                status: 'PROCESSING',
                attempts: 1,
              },
            ],
          };
        }
        if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...withdrawal, status: 'PROCESSING' }] };
        }
        if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
          return { rows: [{ available_balance: '10.0', locked_balance: '1.0' }] };
        }
        if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
          return { rows: [{ ...withdrawal, status: 'COMPLETED', tx_hash: 'tx_worker1' }] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };

    const clientWorker2 = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id FROM te_withdrawals')) {
          return { rows: [] }; // Skipped by SKIP LOCKED!
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };

    const poolWorker1 = { connect: vi.fn().mockResolvedValue(clientWorker1) } as unknown as Pool;
    const poolWorker2 = { connect: vi.fn().mockResolvedValue(clientWorker2) } as unknown as Pool;

    const worker1 = new WithdrawalWorker(poolWorker1, { adapter, workerId: 'w1' });
    const worker2 = new WithdrawalWorker(poolWorker2, { adapter, workerId: 'w2' });

    const [res1, res2] = await Promise.all([
      worker1.processPendingWithdrawals(),
      worker2.processPendingWithdrawals(),
    ]);

    expect(res1).toBe(1);
    expect(res2).toBe(0);
    expect(adapter.sentTransfers.length).toBe(1); // Exactly one broadcast
  });

  it('10. DB failure between status transitions: rollback maintains consistent state', async () => {
    const withdrawal = {
      id: 'wd_db_fail_010',
      operation_id: 'op_wd_db_fail_010',
      user_id: 'u_db_fail',
      amount: '3.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      tx_hash: null,
      attempts: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    let locked = false;
    let rollbackExecuted = false;

    clientMock.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') {
        rollbackExecuted = true;
        return { rows: [] };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('SELECT id FROM te_withdrawals')) {
        if (!locked) {
          locked = true;
          return { rows: [{ id: withdrawal.id }] };
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        return {
          rows: [
            {
              ...withdrawal,
              status: 'PROCESSING',
              attempts: 1,
            },
          ],
        };
      }
      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ ...withdrawal, status: 'PROCESSING' }] };
      }
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        // Simulate DB crash during markCompleted
        throw new Error('PostgreSQL Connection Terminated unexpectedly');
      }
      return { rowCount: 1, rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, { adapter, workerId: 'w_db_fail' });
    await worker.processPendingWithdrawals();

    expect(rollbackExecuted).toBe(true);
  });
});
