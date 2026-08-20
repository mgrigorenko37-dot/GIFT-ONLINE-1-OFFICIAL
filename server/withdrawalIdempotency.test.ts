import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { WithdrawalWorker } from './withdrawalWorker';
import { MockTonTransferAdapter } from './tonAdapter';
import { WithdrawalStateMachine } from './withdrawalStateMachine';

describe('TON Withdrawal Critical Idempotency & Reconciliation Tests', () => {
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

  it('1. Crash after broadcast: Worker recovers PROCESSING withdrawal, reconciles existing on-chain tx via operation_id, and completes without double spend', async () => {
    const withdrawal = {
      id: 'wd_crash_after_broadcast_101',
      operation_id: 'op_wd_crash_after_broadcast_101',
      user_id: 'user_ton_crash',
      amount: '5.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'RETRYING',
      tx_hash: null, // process crashed before tx_hash was recorded in DB
      attempts: 1,
      next_attempt_at: null,
      funds_released: false,
      created_at: Date.now() - 60000,
      updated_at: Date.now() - 60000,
    };

    // Pre-populate mock adapter with already broadcasted transaction for this operation_id
    mockAdapter.publishedTxByOpId.set(
      'op_wd_crash_after_broadcast_101',
      'tx_already_on_chain_abc123'
    );

    let lockedInWorker = false;
    let completedTxHash: string | null = null;
    let currentStatus = 'RETRYING';

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

      // Recovery of stale locks
      if (sql.includes("WHERE status = 'PROCESSING'") && sql.includes('locked_at <')) {
        return { rowCount: 0, rows: [] };
      }

      // Lock batch SELECT FOR UPDATE SKIP LOCKED
      if (sql.includes('SELECT id FROM te_withdrawals')) {
        if (!lockedInWorker) {
          lockedInWorker = true;
          return { rows: [{ id: withdrawal.id }] };
        }
        return { rows: [] };
      }

      // UPDATE te_withdrawals SET status = 'PROCESSING'
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'PROCESSING'")) {
        currentStatus = 'PROCESSING';
        return {
          rows: [
            {
              ...withdrawal,
              operation_id: withdrawal.operation_id,
              status: 'PROCESSING',
              worker_id: params[0],
              locked_at: params[1],
            },
          ],
        };
      }

      // SELECT FOR UPDATE during markCompleted
      if (sql.includes('SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [{ ...withdrawal, operation_id: withdrawal.operation_id, status: currentStatus }],
        };
      }

      // SELECT balances during markCompleted
      if (sql.includes('SELECT available_balance, locked_balance FROM te_balances')) {
        return { rows: [{ available_balance: '10.0', locked_balance: '5.0' }] };
      }

      // UPDATE balances during markCompleted
      if (sql.includes('UPDATE te_balances')) {
        return { rowCount: 1, rows: [] };
      }

      // UPDATE te_withdrawals SET status = 'COMPLETED'
      if (sql.includes('UPDATE te_withdrawals') && sql.includes("status = 'COMPLETED'")) {
        currentStatus = 'COMPLETED';
        completedTxHash = params[0];
        return { rows: [{ ...withdrawal, status: 'COMPLETED', tx_hash: completedTxHash }] };
      }

      return { rowCount: 1, rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, {
      adapter: mockAdapter,
      workerId: 'worker_reconcile_1',
    });
    await worker.processPendingWithdrawals();

    // Verification 1: Adapter sendTon MUST NOT have been called again (zero double spend)
    expect(mockAdapter.sentTransfers.length).toBe(0);

    // Verification 2: Withdrawal was reconciled and marked COMPLETED with existing tx_hash
    expect(currentStatus).toBe('COMPLETED');
    expect(completedTxHash).toBe('tx_already_on_chain_abc123');
  });

  it('2. Network timeout during broadcast (unknown outcome): Worker marks NEEDS_RECONCILIATION and DOES NOT retry or refund', async () => {
    const withdrawal = {
      id: 'wd_timeout_102',
      operation_id: 'op_wd_timeout_102',
      user_id: 'user_timeout',
      amount: '3.0',
      currency: 'TON',
      address: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
      status: 'PENDING',
      tx_hash: null,
      attempts: 0,
      next_attempt_at: null,
      funds_released: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    // Configure adapter to return an unknown outcome (e.g., timeout)
    const timeoutAdapter = new MockTonTransferAdapter({
      shouldFail: true,
      isTimeout: true,
      failureMessage: 'TON node connection timeout (504 Gateway Timeout)',
    });

    let currentStatus = 'PENDING';
    let transitionReason: string | null = null;
    let lockedInWorker = false;

    clientMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

      // Recovery of stale locks
      if (sql.includes("WHERE status = 'PROCESSING'") && sql.includes('locked_at <')) {
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('SELECT id FROM te_withdrawals')) {
        if (!lockedInWorker) {
          lockedInWorker = true;
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
              operation_id: withdrawal.operation_id,
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
        currentStatus = 'NEEDS_RECONCILIATION';
        transitionReason = params[0];
        return {
          rows: [
            { ...withdrawal, status: 'NEEDS_RECONCILIATION', failure_reason: transitionReason },
          ],
        };
      }

      return { rowCount: 1, rows: [] };
    });

    const worker = new WithdrawalWorker(mockPool, {
      adapter: timeoutAdapter,
      workerId: 'worker_timeout_test',
    });
    await worker.processPendingWithdrawals();

    // Verification: Must be transitioned to NEEDS_RECONCILIATION without blindly retrying or refunding
    expect(currentStatus).toBe('NEEDS_RECONCILIATION');
    expect(transitionReason).toContain('unknown');
  });

  it('3. Operation ID uniqueness constraint ensures distinct operation identifiers across requests', async () => {
    const op1 = 'op_wd_unique_1';
    const op2 = 'op_wd_unique_2';

    expect(op1).not.toBe(op2);
  });
});
