import { Pool } from 'pg';
import crypto from 'crypto';
import { TonTransferAdapter, ProductionTonTransferAdapter } from './tonAdapter';
import { WithdrawalStateMachine, WithdrawalRecord } from './withdrawalStateMachine';

export interface WithdrawalWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  adapter?: TonTransferAdapter;
  workerId?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  staleLockAgeMs?: number;
}

export class WithdrawalWorker {
  private pool: Pool;
  private adapter: TonTransferAdapter;
  private intervalMs: number;
  private batchSize: number;
  private workerId: string;
  private maxAttempts: number;
  private retryDelayMs: number;
  private staleLockAgeMs: number;
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(pool: Pool, options?: WithdrawalWorkerOptions) {
    this.pool = pool;
    this.intervalMs = options?.intervalMs ?? 3000;
    this.batchSize = options?.batchSize ?? 10;
    this.adapter = options?.adapter ?? new ProductionTonTransferAdapter();
    this.workerId =
      options?.workerId ?? `worker_${process.pid}_${crypto.randomUUID().substring(0, 8)}`;
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 15000;
    this.staleLockAgeMs = options?.staleLockAgeMs ?? 120000; // 2 mins
  }

  public start() {
    if (this.intervalId) return;
    console.log(
      `[WithdrawalWorker] Starting background worker '${this.workerId}' (interval: ${this.intervalMs}ms)...`
    );
    this.intervalId = setInterval(() => {
      this.processCycle().catch((err) => {
        console.error('[WithdrawalWorker] Unhandled error during cycle:', err);
      });
    }, this.intervalMs);

    // Initial immediate cycle
    setTimeout(() => {
      this.processCycle().catch(console.error);
    }, 100);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log(`[WithdrawalWorker] Stopped worker '${this.workerId}'.`);
    }
  }

  /**
   * Run one complete worker processing cycle:
   * 1. Recover stale PROCESSING records from crashed workers.
   * 2. Lock and process pending withdrawals through the State Machine.
   */
  public async processCycle(): Promise<number> {
    await this.recoverStaleLocks();
    return await this.processPendingWithdrawals();
  }

  /**
   * Recover stale PROCESSING records
   */
  public async recoverStaleLocks(): Promise<number> {
    const client = await this.pool.connect();
    try {
      return await WithdrawalStateMachine.recoverStaleProcessingRecords(
        client,
        this.staleLockAgeMs
      );
    } catch (e: any) {
      if (e?.code === '42P01' || e?.message?.includes('does not exist')) {
        return 0;
      }
      console.error('[WithdrawalWorker] Error during stale lock recovery:', e);
      return 0;
    } finally {
      client.release();
    }
  }

  /**
   * Process a batch of pending/retrying withdrawals safely and idempotently.
   */
  public async processPendingWithdrawals(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    let processedCount = 0;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Lock batch using State Machine Compare-And-Set & FOR UPDATE SKIP LOCKED
      const lockedBatch: WithdrawalRecord[] = await WithdrawalStateMachine.lockBatchForProcessing(
        client,
        this.batchSize,
        this.workerId,
        Date.now()
      );

      await client.query('COMMIT');

      if (lockedBatch.length === 0) {
        return 0;
      }

      // Process each locked withdrawal
      for (const item of lockedBatch) {
        const {
          id: withdrawalId,
          user_id: userId,
          amount,
          currency,
          address,
          attempts,
          tx_hash,
        } = item;
        let operationId = item.operation_id;

        // 1. Ensure persistent operation_id exists in DB BEFORE any broadcast
        if (!operationId) {
          operationId = `op_${withdrawalId}_${crypto.randomUUID().substring(0, 8)}`;
          const opClient = await this.pool.connect();
          try {
            await opClient.query(
              `UPDATE te_withdrawals SET operation_id = $1 WHERE id = $2 AND operation_id IS NULL`,
              [operationId, withdrawalId]
            );
          } catch (e) {
            console.error(
              `[WithdrawalWorker] Error persisting operation_id for ${withdrawalId}:`,
              e
            );
          } finally {
            opClient.release();
          }
        }

        // 2. Reconciliation check: Before broadcast (or re-broadcast), verify if tx was already published on-chain or recorded in DB
        let existingTxHash = tx_hash;
        if (!existingTxHash && this.adapter.checkTransactionByOperationId) {
          try {
            const checkRes = await this.adapter.checkTransactionByOperationId(operationId, address);
            if (checkRes.found && checkRes.txHash) {
              existingTxHash = checkRes.txHash;
              console.log(
                `[WithdrawalWorker] Reconciled on-chain transaction for ${withdrawalId} (op:${operationId}): ${existingTxHash}`
              );
            }
          } catch (e) {
            console.error(
              `[WithdrawalWorker] Error during on-chain reconciliation for ${withdrawalId}:`,
              e
            );
          }
        }

        // If transaction already exists on-chain or in DB, complete it immediately without re-calling adapter.sendTon
        if (existingTxHash) {
          const updateClient = await this.pool.connect();
          try {
            await updateClient.query('BEGIN');
            await WithdrawalStateMachine.markCompleted(
              updateClient,
              withdrawalId,
              existingTxHash,
              this.workerId,
              Date.now()
            );
            await updateClient.query('COMMIT');
            console.log(
              `[WithdrawalWorker] Completed withdrawal ${withdrawalId} via reconciled txHash: ${existingTxHash}`
            );
            processedCount++;
            continue;
          } catch (updateErr) {
            try {
              await updateClient.query('ROLLBACK');
            } catch {}
            console.error(
              `[WithdrawalWorker] Error marking reconciled withdrawal ${withdrawalId} completed:`,
              updateErr
            );
            continue;
          } finally {
            updateClient.release();
          }
        }

        // 3. Execute broadcast passing the UNIQUE operation_id in memo/payload
        console.log(
          `[WithdrawalWorker] [${this.workerId}] Transferring ${amount} ${currency} -> ${address} (op:${operationId}, attempt #${attempts})`
        );
        const transferResult = await this.adapter.sendTon(
          address,
          amount,
          `Withdrawal #${withdrawalId}`,
          operationId
        );

        const updateClient = await this.pool.connect();
        try {
          await updateClient.query('BEGIN');

          if (transferResult.success && transferResult.txHash) {
            // State Machine Transition: PROCESSING -> COMPLETED
            await WithdrawalStateMachine.markCompleted(
              updateClient,
              withdrawalId,
              transferResult.txHash,
              this.workerId,
              Date.now()
            );
            console.log(
              `[WithdrawalWorker] Successfully completed withdrawal ${withdrawalId}. TxHash: ${transferResult.txHash}`
            );
          } else if (transferResult.isUnknown) {
            // Unknown broadcast outcome (e.g., timeout / network partition)
            // DO NOT blindly retry or release funds. Move to NEEDS_RECONCILIATION for manual / scheduled safety check.
            await WithdrawalStateMachine.markNeedsReconciliation(
              updateClient,
              withdrawalId,
              `Broadcast outcome unknown (network timeout): ${transferResult.error || 'Timeout'}`,
              this.workerId,
              Date.now()
            );
            console.warn(
              `[WithdrawalWorker] Withdrawal ${withdrawalId} (op:${operationId}) broadcast status unknown. Transitioned to NEEDS_RECONCILIATION.`
            );
          } else {
            const failureReason = transferResult.error || 'Unknown TON transfer failure';

            if (attempts < this.maxAttempts) {
              // State Machine Transition: PROCESSING -> RETRYING
              await WithdrawalStateMachine.markRetrying(
                updateClient,
                withdrawalId,
                failureReason,
                this.retryDelayMs,
                this.workerId,
                Date.now()
              );
              console.warn(
                `[WithdrawalWorker] Withdrawal ${withdrawalId} failed (${failureReason}). Marked RETRYING in ${this.retryDelayMs}ms.`
              );
            } else {
              // Max attempts reached: State Machine Transition: PROCESSING -> FAILED
              await WithdrawalStateMachine.markFailed(
                updateClient,
                withdrawalId,
                `Max attempts (${this.maxAttempts}) exceeded: ${failureReason}`,
                this.workerId,
                Date.now()
              );
              console.warn(
                `[WithdrawalWorker] Withdrawal ${withdrawalId} FAILED permanently. Balance refunded.`
              );
            }
          }

          await updateClient.query('COMMIT');
          processedCount++;
        } catch (updateErr) {
          try {
            await updateClient.query('ROLLBACK');
          } catch {}
          console.error(
            `[WithdrawalWorker] Error updating state machine for ${withdrawalId}:`,
            updateErr
          );
        } finally {
          updateClient.release();
        }
      }
    } catch (e: any) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      if (e?.code === '42P01' || e?.message?.includes('does not exist')) {
        return 0;
      }
      console.error('[WithdrawalWorker] Error in processPendingWithdrawals:', e);
    } finally {
      client.release();
      this.isProcessing = false;
    }

    return processedCount;
  }
}

let globalWithdrawalWorker: WithdrawalWorker | null = null;

export function startWithdrawalWorker(
  pool: Pool,
  options?: WithdrawalWorkerOptions
): WithdrawalWorker {
  if (!globalWithdrawalWorker) {
    globalWithdrawalWorker = new WithdrawalWorker(pool, options);
    globalWithdrawalWorker.start();
  }
  return globalWithdrawalWorker;
}

export function stopWithdrawalWorker() {
  if (globalWithdrawalWorker) {
    globalWithdrawalWorker.stop();
    globalWithdrawalWorker = null;
  }
}
