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
    this.workerId = options?.workerId ?? `worker_${process.pid}_${crypto.randomUUID().substring(0, 8)}`;
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 15000;
    this.staleLockAgeMs = options?.staleLockAgeMs ?? 120000; // 2 mins
  }

  public start() {
    if (this.intervalId) return;
    console.log(`[WithdrawalWorker] Starting background worker '${this.workerId}' (interval: ${this.intervalMs}ms)...`);
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
      return await WithdrawalStateMachine.recoverStaleProcessingRecords(client, this.staleLockAgeMs);
    } catch (e) {
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
        const { id: withdrawalId, user_id: userId, amount, currency, address, attempts } = item;
        console.log(`[WithdrawalWorker] [${this.workerId}] Transferring ${amount} ${currency} -> ${address} (attempt #${attempts})`);

        const transferResult = await this.adapter.sendTon(address, amount, `Withdrawal #${withdrawalId}`);
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
            console.log(`[WithdrawalWorker] Successfully completed withdrawal ${withdrawalId}. TxHash: ${transferResult.txHash}`);
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
              console.warn(`[WithdrawalWorker] Withdrawal ${withdrawalId} failed (${failureReason}). Marked RETRYING in ${this.retryDelayMs}ms.`);
            } else {
              // Max attempts reached: State Machine Transition: PROCESSING -> FAILED
              await WithdrawalStateMachine.markFailed(
                updateClient,
                withdrawalId,
                `Max attempts (${this.maxAttempts}) exceeded: ${failureReason}`,
                this.workerId,
                Date.now()
              );
              console.warn(`[WithdrawalWorker] Withdrawal ${withdrawalId} FAILED permanently. Balance refunded.`);
            }
          }

          await updateClient.query('COMMIT');
          processedCount++;
        } catch (updateErr) {
          try {
            await updateClient.query('ROLLBACK');
          } catch {}
          console.error(`[WithdrawalWorker] Error updating state machine for ${withdrawalId}:`, updateErr);
        } finally {
          updateClient.release();
        }
      }
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      console.error('[WithdrawalWorker] Error in processPendingWithdrawals:', e);
    } finally {
      client.release();
      this.isProcessing = false;
    }

    return processedCount;
  }
}

let globalWithdrawalWorker: WithdrawalWorker | null = null;

export function startWithdrawalWorker(pool: Pool, options?: WithdrawalWorkerOptions): WithdrawalWorker {
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
