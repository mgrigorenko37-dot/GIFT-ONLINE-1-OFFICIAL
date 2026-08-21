import { PoolClient } from 'pg';
import Decimal from 'decimal.js';

export type WithdrawalStatus =
  'PENDING' | 'PROCESSING' | 'RETRYING' | 'COMPLETED' | 'FAILED' | 'NEEDS_RECONCILIATION';

export interface WithdrawalRecord {
  id: string;
  operation_id: string;
  user_id: string;
  amount: string; // Exact decimal string from PostgreSQL NUMERIC (never converted to JS float number)
  currency: string;
  address: string;
  status: WithdrawalStatus;
  tx_hash: string | null;
  failure_reason: string | null;
  attempts: number;
  next_attempt_at: number | null;
  locked_at: number | null;
  processed_at: number | null;
  worker_id: string | null;
  funds_released: boolean;
  funds_released_at: number | null;
  created_at: number;
  updated_at: number;
}

export const VALID_STATUS_TRANSITIONS: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  PENDING: ['PROCESSING'],
  PROCESSING: ['COMPLETED', 'FAILED', 'RETRYING', 'NEEDS_RECONCILIATION'],
  RETRYING: ['PROCESSING', 'NEEDS_RECONCILIATION'],
  NEEDS_RECONCILIATION: ['COMPLETED', 'FAILED', 'RETRYING'], // Can be resolved automatically via reconciliation or manually
  FAILED: ['PENDING'], // Allowed only via explicit retry flow
  COMPLETED: [], // Terminal state - NO transitions allowed
};

export class WithdrawalTransitionError extends Error {
  public code: string;
  constructor(message: string, code = 'INVALID_TRANSITION') {
    super(message);
    this.name = 'WithdrawalTransitionError';
    this.code = code;
  }
}

export class WithdrawalStateMachine {
  /**
   * Validate if a transition between two states is allowed.
   */
  public static isTransitionAllowed(from: WithdrawalStatus, to: WithdrawalStatus): boolean {
    const allowed = VALID_STATUS_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Helper: Record financial audit entry inside the active transaction
   */
  public static async recordFinancialAudit(
    client: PoolClient,
    eventType: string,
    userId: string,
    referenceId: string,
    currency: string,
    amount: Decimal,
    availableBefore: Decimal,
    availableAfter: Decimal,
    lockedBefore: Decimal,
    lockedAfter: Decimal,
    metadata?: any,
    now: number = Date.now()
  ): Promise<void> {
    await client.query(
      `INSERT INTO te_financial_audits (
        event_type, user_id, reference_id, currency, amount,
        available_before, available_after, locked_before, locked_after,
        metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        eventType,
        userId,
        referenceId,
        currency,
        amount.toString(),
        availableBefore.toString(),
        availableAfter.toString(),
        lockedBefore.toString(),
        lockedAfter.toString(),
        metadata ? JSON.stringify(metadata) : null,
        now,
      ]
    );
  }

  /**
   * Lock a batch of PENDING / RETRYING withdrawals for a worker instance.
   */
  public static async lockBatchForProcessing(
    client: PoolClient,
    batchSize: number,
    workerId: string,
    now: number = Date.now()
  ): Promise<WithdrawalRecord[]> {
    const selectRes = await client.query(
      `SELECT id FROM te_withdrawals
       WHERE status IN ('PENDING', 'RETRYING')
         AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [now, batchSize]
    );

    if (selectRes.rows.length === 0) {
      return [];
    }

    const ids = selectRes.rows.map((r: any) => r.id);
    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET status = 'PROCESSING',
           worker_id = $1,
           locked_at = $2,
           attempts = attempts + 1,
           updated_at = $2
       WHERE id = ANY($3) AND status IN ('PENDING', 'RETRYING')
       RETURNING *`,
      [workerId, now, ids]
    );

    return updateRes.rows.map(this.mapRowToRecord);
  }

  /**
   * Transition PENDING -> PROCESSING with worker lock.
   */
  public static async lockForProcessing(
    client: PoolClient,
    withdrawalId: string,
    workerId: string,
    now: number = Date.now()
  ): Promise<WithdrawalRecord | null> {
    const selectRes = await client.query(
      `SELECT * FROM te_withdrawals 
       WHERE id = $1 AND status IN ('PENDING', 'RETRYING') 
         AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
       FOR UPDATE SKIP LOCKED`,
      [withdrawalId, now]
    );

    if (selectRes.rows.length === 0) {
      return null;
    }

    const current = selectRes.rows[0];
    const newAttempts = Number(current.attempts || 0) + 1;

    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET status = 'PROCESSING',
           worker_id = $1,
           locked_at = $2,
           attempts = $3,
           updated_at = $2
       WHERE id = $4 AND status IN ('PENDING', 'RETRYING')
       RETURNING *`,
      [workerId, now, newAttempts, withdrawalId]
    );

    if (updateRes.rows.length === 0) {
      return null;
    }

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  /**
   * Transition PROCESSING -> COMPLETED.
   * Requires valid tx_hash.
   * Decreases locked_balance permanently without returning funds to available_balance.
   * Strictly idempotent.
   */
  public static async markCompleted(
    client: PoolClient,
    withdrawalId: string,
    txHash: string,
    workerId: string,
    now: number = Date.now()
  ): Promise<WithdrawalRecord> {
    if (!txHash || !txHash.trim()) {
      throw new WithdrawalTransitionError(
        'Cannot transition to COMPLETED without a valid tx_hash.',
        'MISSING_TX_HASH'
      );
    }

    // 1. Lock withdrawal row
    const checkRes = await client.query(`SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE`, [
      withdrawalId,
    ]);

    if (checkRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Withdrawal ${withdrawalId} not found.`, 'NOT_FOUND');
    }

    const current: WithdrawalRecord = this.mapRowToRecord(checkRes.rows[0]);
    if (current.status === 'COMPLETED') {
      return current; // Idempotent
    }

    if (current.status !== 'PROCESSING' && current.status !== 'RETRYING') {
      throw new WithdrawalTransitionError(
        `Cannot transition to COMPLETED from status '${current.status}'. Must be in 'PROCESSING' or 'RETRYING'.`,
        'INVALID_CURRENT_STATUS'
      );
    }

    const amountDecimal = new Decimal(current.amount);

    // 2. Lock and update balances using Decimal
    const balRes = await client.query(
      `SELECT available_balance, locked_balance FROM te_balances
       WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [current.user_id, current.currency]
    );

    if (balRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Balance record not found for user ${current.user_id}`);
    }

    const availableBefore = new Decimal(balRes.rows[0].available_balance || 0);
    const lockedBefore = new Decimal(balRes.rows[0].locked_balance || 0);
    const availableAfter = availableBefore; // unchanged
    const lockedAfter = Decimal.max(0, lockedBefore.minus(amountDecimal));

    await client.query(
      `UPDATE te_balances
       SET locked_balance = $1,
           updated_at = $2
       WHERE user_id = $3 AND currency = $4`,
      [lockedAfter.toString(), now, current.user_id, current.currency]
    );

    // 3. Record financial audit event
    await this.recordFinancialAudit(
      client,
      'WITHDRAWAL_COMPLETED',
      current.user_id,
      withdrawalId,
      current.currency,
      amountDecimal,
      availableBefore,
      availableAfter,
      lockedBefore,
      lockedAfter,
      { txHash: txHash.trim(), workerId },
      now
    );

    // 4. Update withdrawal record
    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET status = 'COMPLETED',
           tx_hash = $1,
           processed_at = $2,
           failure_reason = NULL,
           locked_at = NULL,
           updated_at = $2
       WHERE id = $3 AND status IN ('PROCESSING', 'RETRYING')
       RETURNING *`,
      [txHash.trim(), now, withdrawalId]
    );

    if (updateRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Failed atomic update to COMPLETED for ${withdrawalId}.`);
    }

    // 5. Outbox events
    await client.query(
      `UPDATE te_outbox_events
       SET status = 'published', published_at = $1
       WHERE event_type = 'withdrawalCreated'
         AND payload LIKE $2`,
      [now, `%"withdrawalId":"${withdrawalId}"%`]
    );

    await client.query(
      `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'withdrawalCompleted',
        current.user_id,
        JSON.stringify({
          withdrawalId,
          userId: current.user_id,
          amount: current.amount,
          currency: current.currency,
          address: current.address,
          txHash: txHash.trim(),
          status: 'COMPLETED',
        }),
        'pending',
        current.currency,
        now,
      ]
    );

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  /**
   * releaseWithdrawalFunds(client, withdrawalId, reason, workerId)
   * Dedicated, atomic function to unlock funds for a failed withdrawal exactly once.
   * Guarantees:
   * - locked_balance decreases by withdrawal.amount (min 0)
   * - available_balance increases by withdrawal.amount
   * - funds_released flag is set to TRUE
   * - Executed exactly once; duplicate calls are no-ops
   * - Balances never become negative
   * - Writes financial audit record
   */
  public static async releaseWithdrawalFunds(
    client: PoolClient,
    withdrawalId: string,
    reason: string = 'Withdrawal failed',
    workerId?: string,
    now: number = Date.now()
  ): Promise<{ released: boolean; withdrawal: WithdrawalRecord }> {
    // 1. Lock withdrawal record
    const checkRes = await client.query(`SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE`, [
      withdrawalId,
    ]);

    if (checkRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Withdrawal ${withdrawalId} not found.`, 'NOT_FOUND');
    }

    const current: WithdrawalRecord = this.mapRowToRecord(checkRes.rows[0]);

    // Guard: only allow release if funds have not been released yet
    if (current.funds_released) {
      console.log(
        `[WithdrawalStateMachine] Funds for withdrawal ${withdrawalId} already released previously. Skipping release.`
      );
      return { released: false, withdrawal: current };
    }

    // Must be in FAILED status or transitioning to FAILED from PROCESSING
    if (current.status !== 'FAILED' && current.status !== 'PROCESSING') {
      throw new WithdrawalTransitionError(
        `Cannot release funds for withdrawal in '${current.status}' status. Must be FAILED or PROCESSING.`,
        'INVALID_STATUS_FOR_RELEASE'
      );
    }

    const amountDecimal = new Decimal(current.amount);

    // 2. Lock user balances
    const balRes = await client.query(
      `SELECT available_balance, locked_balance FROM te_balances
       WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [current.user_id, current.currency]
    );

    if (balRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Balance not found for user ${current.user_id}`);
    }

    const availableBefore = new Decimal(balRes.rows[0].available_balance || 0);
    const lockedBefore = new Decimal(balRes.rows[0].locked_balance || 0);

    const availableAfter = availableBefore.plus(amountDecimal);
    const lockedAfter = Decimal.max(0, lockedBefore.minus(amountDecimal));

    // 3. Atomically update balances
    await client.query(
      `UPDATE te_balances
       SET available_balance = $1,
           locked_balance = $2,
           updated_at = $3
       WHERE user_id = $4 AND currency = $5`,
      [availableAfter.toString(), lockedAfter.toString(), now, current.user_id, current.currency]
    );

    // 4. Mark funds_released = true on withdrawal record
    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET funds_released = TRUE,
           funds_released_at = $1,
           updated_at = $1
       WHERE id = $2 AND funds_released = FALSE
       RETURNING *`,
      [now, withdrawalId]
    );

    if (updateRes.rows.length === 0) {
      // Concurrently released by another transaction
      return { released: false, withdrawal: current };
    }

    // 5. Record Financial Audit
    await this.recordFinancialAudit(
      client,
      'WITHDRAWAL_FUNDS_RELEASED',
      current.user_id,
      withdrawalId,
      current.currency,
      amountDecimal,
      availableBefore,
      availableAfter,
      lockedBefore,
      lockedAfter,
      { reason, workerId },
      now
    );

    return { released: true, withdrawal: this.mapRowToRecord(updateRes.rows[0]) };
  }

  /**
   * Transition PROCESSING -> FAILED.
   * Atomically transitions status and invokes releaseWithdrawalFunds.
   */
  public static async markFailed(
    client: PoolClient,
    withdrawalId: string,
    failureReason: string,
    workerId: string,
    now: number = Date.now()
  ): Promise<WithdrawalRecord> {
    if (!failureReason || !failureReason.trim()) {
      throw new WithdrawalTransitionError(
        'Cannot transition to FAILED without a valid failure_reason.',
        'MISSING_FAILURE_REASON'
      );
    }

    const checkRes = await client.query(`SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE`, [
      withdrawalId,
    ]);

    if (checkRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Withdrawal ${withdrawalId} not found.`, 'NOT_FOUND');
    }

    const current: WithdrawalRecord = this.mapRowToRecord(checkRes.rows[0]);
    if (current.status === 'FAILED') {
      // Ensure funds are released even if already in FAILED state
      if (!current.funds_released) {
        await this.releaseWithdrawalFunds(client, withdrawalId, failureReason, workerId, now);
      }
      return current;
    }

    if (current.status !== 'PROCESSING') {
      throw new WithdrawalTransitionError(
        `Cannot transition to FAILED from status '${current.status}'. Must be in 'PROCESSING'.`,
        'INVALID_CURRENT_STATUS'
      );
    }

    // 1. Release funds atomically
    await this.releaseWithdrawalFunds(client, withdrawalId, failureReason, workerId, now);

    // 2. Transition withdrawal record to FAILED
    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET status = 'FAILED',
           failure_reason = $1,
           processed_at = $2,
           locked_at = NULL,
           updated_at = $2
       WHERE id = $3 AND status = 'PROCESSING'
       RETURNING *`,
      [failureReason.trim(), now, withdrawalId]
    );

    if (updateRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Failed atomic update to FAILED for ${withdrawalId}.`);
    }

    // 3. Mark created outbox event as failed
    await client.query(
      `UPDATE te_outbox_events
       SET status = 'failed'
       WHERE event_type = 'withdrawalCreated'
         AND payload LIKE $1`,
      [`%"withdrawalId":"${withdrawalId}"%`]
    );

    // 4. Emit failed outbox event
    await client.query(
      `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'withdrawalFailed',
        current.user_id,
        JSON.stringify({
          withdrawalId,
          userId: current.user_id,
          amount: current.amount,
          currency: current.currency,
          address: current.address,
          failureReason: failureReason.trim(),
          status: 'FAILED',
        }),
        'pending',
        current.currency,
        now,
      ]
    );

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  /**
   * Transition PROCESSING -> RETRYING.
   */
  public static async markRetrying(
    client: PoolClient,
    withdrawalId: string,
    failureReason: string,
    retryDelayMs: number = 30000,
    workerId: string,
    now: number = Date.now()
  ): Promise<WithdrawalRecord> {
    const nextAttemptAt = now + retryDelayMs;

    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET status = 'RETRYING',
           failure_reason = $1,
           next_attempt_at = $2,
           locked_at = NULL,
           worker_id = NULL,
           updated_at = $3
       WHERE id = $4 AND status = 'PROCESSING'
       RETURNING *`,
      [failureReason.trim(), nextAttemptAt, now, withdrawalId]
    );

    if (updateRes.rows.length === 0) {
      throw new WithdrawalTransitionError(
        `Cannot transition ${withdrawalId} to RETRYING; record not found or not in PROCESSING.`
      );
    }

    const current = this.mapRowToRecord(updateRes.rows[0]);

    await client.query(
      `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'withdrawalRetrying',
        current.user_id,
        JSON.stringify({
          withdrawalId,
          userId: current.user_id,
          amount: current.amount,
          currency: current.currency,
          address: current.address,
          failureReason: failureReason.trim(),
          nextAttemptAt: nextAttemptAt,
          status: 'RETRYING',
        }),
        'pending',
        current.currency,
        now,
      ]
    );

    return current;
  }

  /**
   * Explicit Retry Flow: FAILED -> PENDING.
   * Checks available balance, re-locks funds, resets funds_released flag.
   */
  public static async retryFailedWithdrawal(
    client: PoolClient,
    withdrawalId: string,
    now: number = Date.now()
  ): Promise<WithdrawalRecord> {
    const checkRes = await client.query(`SELECT * FROM te_withdrawals WHERE id = $1 FOR UPDATE`, [
      withdrawalId,
    ]);

    if (checkRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Withdrawal ${withdrawalId} not found.`, 'NOT_FOUND');
    }

    const current: WithdrawalRecord = this.mapRowToRecord(checkRes.rows[0]);
    if (current.status !== 'FAILED') {
      throw new WithdrawalTransitionError(
        `Cannot retry withdrawal in '${current.status}' status. Only FAILED withdrawals can be retried.`,
        'INVALID_CURRENT_STATUS'
      );
    }

    const amountDecimal = new Decimal(current.amount);

    // Lock balances
    const balRes = await client.query(
      `SELECT available_balance, locked_balance FROM te_balances
       WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [current.user_id, current.currency]
    );

    if (balRes.rows.length === 0) {
      throw new WithdrawalTransitionError(`Balance not found for user ${current.user_id}`);
    }

    const availableBefore = new Decimal(balRes.rows[0].available_balance || 0);
    const lockedBefore = new Decimal(balRes.rows[0].locked_balance || 0);

    if (availableBefore.lessThan(amountDecimal)) {
      throw new WithdrawalTransitionError(
        `Insufficient available funds for retry: ${availableBefore.toString()} ${current.currency} available, ${amountDecimal.toString()} required.`,
        'INSUFFICIENT_FUNDS'
      );
    }

    const availableAfter = availableBefore.minus(amountDecimal);
    const lockedAfter = lockedBefore.plus(amountDecimal);

    // Re-lock balance
    await client.query(
      `UPDATE te_balances
       SET available_balance = $1,
           locked_balance = $2,
           updated_at = $3
       WHERE user_id = $4 AND currency = $5`,
      [availableAfter.toString(), lockedAfter.toString(), now, current.user_id, current.currency]
    );

    // Record audit
    await this.recordFinancialAudit(
      client,
      'WITHDRAWAL_RETRY_LOCKED',
      current.user_id,
      withdrawalId,
      current.currency,
      amountDecimal,
      availableBefore,
      availableAfter,
      lockedBefore,
      lockedAfter,
      null,
      now
    );

    // Update status to PENDING
    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET status = 'PENDING',
           failure_reason = NULL,
           next_attempt_at = NULL,
           worker_id = NULL,
           locked_at = NULL,
           funds_released = FALSE,
           funds_released_at = NULL,
           updated_at = $1
       WHERE id = $2 AND status = 'FAILED'
       RETURNING *`,
      [now, withdrawalId]
    );

    return this.mapRowToRecord(updateRes.rows[0]);
  }

  /**
   * Disaster Recovery: Reset stale PROCESSING records after worker crash.
   */
  public static async recoverStaleProcessingRecords(
    client: PoolClient,
    maxLockAgeMs: number = 120000,
    now: number = Date.now()
  ): Promise<number> {
    const threshold = now - maxLockAgeMs;
    const res = await client.query(
      `UPDATE te_withdrawals
       SET status = 'RETRYING',
           failure_reason = 'Worker lock timed out / server restarted',
           next_attempt_at = $1,
           locked_at = NULL,
           worker_id = NULL,
           updated_at = $1
       WHERE status = 'PROCESSING'
         AND locked_at IS NOT NULL
         AND locked_at < $2`,
      [now, threshold]
    );

    return res.rowCount || 0;
  }

  /**
   * Transition to NEEDS_RECONCILIATION.
   * Placed when broadcast status is unknown or verification is inconclusive.
   * Prevents blind re-transfers.
   */
  public static async markNeedsReconciliation(
    client: PoolClient,
    withdrawalId: string,
    reason: string,
    workerId: string,
    now: number = Date.now()
  ): Promise<WithdrawalRecord> {
    const updateRes = await client.query(
      `UPDATE te_withdrawals
       SET status = 'NEEDS_RECONCILIATION',
           failure_reason = $1,
           locked_at = NULL,
           worker_id = $2,
           updated_at = $3
       WHERE id = $4 AND status IN ('PROCESSING', 'RETRYING')
       RETURNING *`,
      [reason, workerId, now, withdrawalId]
    );

    if (updateRes.rows.length === 0) {
      const checkRes = await client.query(`SELECT * FROM te_withdrawals WHERE id = $1`, [
        withdrawalId,
      ]);
      if (checkRes.rows.length === 0)
        throw new WithdrawalTransitionError(`Withdrawal ${withdrawalId} not found.`);
      return this.mapRowToRecord(checkRes.rows[0]);
    }

    const current = this.mapRowToRecord(updateRes.rows[0]);

    await client.query(
      `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'withdrawalNeedsReconciliation',
        current.user_id,
        JSON.stringify({
          withdrawalId,
          userId: current.user_id,
          amount: current.amount,
          currency: current.currency,
          address: current.address,
          failureReason: reason.trim(),
          status: 'NEEDS_RECONCILIATION',
        }),
        'pending',
        current.currency,
        now,
      ]
    );

    return current;
  }

  public static mapRowToRecord(row: any): WithdrawalRecord {
    return {
      id: row.id,
      operation_id: row.operation_id || row.id,
      user_id: row.user_id,
      amount: String(row.amount),
      currency: row.currency,
      address: row.address,
      status: row.status as WithdrawalStatus,
      tx_hash: row.tx_hash || null,
      failure_reason: row.failure_reason || null,
      attempts: Number(row.attempts || 0),
      next_attempt_at: row.next_attempt_at ? Number(row.next_attempt_at) : null,
      locked_at: row.locked_at ? Number(row.locked_at) : null,
      processed_at: row.processed_at ? Number(row.processed_at) : null,
      worker_id: row.worker_id || null,
      funds_released: Boolean(row.funds_released),
      funds_released_at: row.funds_released_at ? Number(row.funds_released_at) : null,
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
    };
  }
}
