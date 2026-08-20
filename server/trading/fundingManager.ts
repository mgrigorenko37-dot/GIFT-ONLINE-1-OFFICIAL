import { Pool, PoolClient } from 'pg';
import { FundingPayment, FundingPeriodSnapshot, ProcessFundingOptions } from './types';
import { mapPosition } from './mappers';
import { getPositionSnapshotAt } from './positionManager';
import * as crypto from 'crypto';

export async function createFundingPeriodSnapshot(
  pool: Pool,
  snapshot: {
    instrumentKey: string;
    currency: string;
    fundingInterval?: string;
    fundingTimestamp: number;
    fundingRate: number;
    markPrice: number;
    createdAt?: number;
  },
  clientArg?: PoolClient | any
): Promise<FundingPeriodSnapshot> {
  const client = clientArg || (await pool.connect());
  const ownClient = !clientArg;
  try {
    const fundingInterval = snapshot.fundingInterval || '8h';
    const createdAt = snapshot.createdAt || Date.now();
    await client.query(
      `INSERT INTO te_funding_periods
        (instrument_key, currency, funding_interval, funding_timestamp, funding_rate, mark_price, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (instrument_key, currency, funding_interval, funding_timestamp)
       DO UPDATE SET funding_rate = EXCLUDED.funding_rate, mark_price = EXCLUDED.mark_price`,
      [
        snapshot.instrumentKey,
        snapshot.currency,
        fundingInterval,
        snapshot.fundingTimestamp,
        snapshot.fundingRate,
        snapshot.markPrice,
        createdAt,
      ]
    );
    return {
      instrumentKey: snapshot.instrumentKey,
      currency: snapshot.currency,
      fundingInterval,
      fundingTimestamp: snapshot.fundingTimestamp,
      fundingRate: snapshot.fundingRate,
      markPrice: snapshot.markPrice,
      createdAt,
    };
  } finally {
    if (ownClient) {
      client.release();
    }
  }
}

export async function getFundingPeriodSnapshot(
  pool: Pool,
  instrumentKey: string,
  currency: string,
  fundingInterval: string,
  fundingTimestamp: number,
  clientArg?: PoolClient | any
): Promise<FundingPeriodSnapshot | null> {
  const client = clientArg || (await pool.connect());
  const ownClient = !clientArg;
  try {
    const res = await client.query(
      `SELECT * FROM te_funding_periods
       WHERE instrument_key = $1 AND currency = $2 AND funding_interval = $3 AND funding_timestamp = $4`,
      [instrumentKey, currency, fundingInterval, fundingTimestamp]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      instrumentKey: row.instrument_key,
      currency: row.currency,
      fundingInterval: row.funding_interval,
      fundingTimestamp: Number(row.funding_timestamp),
      fundingRate: Number(row.funding_rate),
      markPrice: Number(row.mark_price),
      createdAt: Number(row.created_at),
    };
  } finally {
    if (ownClient) {
      client.release();
    }
  }
}

export async function applyFundingRate(
  pool: Pool,
  clientArg: PoolClient | any,
  options: ProcessFundingOptions
): Promise<FundingPayment[]> {
  let client = clientArg;
  let ownClient = false;
  if (!client) {
    client = await pool.connect();
    ownClient = true;
  }

  try {
    if (ownClient) {
      await client.query('BEGIN');
    }

    const fundingInterval = options.fundingInterval || '8h';
    const fundingTimestamp = options.fundingTimestamp || Date.now();

    if (options.fundingRate != null) {
      if (
        typeof options.fundingRate !== 'number' ||
        isNaN(options.fundingRate) ||
        !Number.isFinite(options.fundingRate)
      ) {
        throw new Error('Invalid fundingRate: must be a valid finite number');
      }
      if (Math.abs(options.fundingRate) > 1.0) {
        throw new Error(
          `Invalid fundingRate (${options.fundingRate}): exceeds maximum allowed range [-1.0, 1.0]`
        );
      }
    }

    let queryStr = `SELECT * FROM te_positions WHERE status IN ('Open', 'MarginCall', 'OPEN', 'MARGIN_CALL') AND qty > 0`;
    const queryParams: any[] = [];

    if (options.positionId) {
      queryParams.push(options.positionId);
      queryStr += ` AND position_id = $${queryParams.length}`;
    }
    if (options.userId) {
      queryParams.push(options.userId);
      queryStr += ` AND user_id = $${queryParams.length}`;
    }
    if (options.instrumentKey) {
      queryParams.push(options.instrumentKey);
      queryStr += ` AND instrument_key = $${queryParams.length}`;
    }
    if (options.currency && !options.positionId) {
      queryParams.push(options.currency);
      queryStr += ` AND (collateral_currency = $${queryParams.length} OR settlement_currency = $${queryParams.length} OR (collateral_currency IS NULL AND settlement_currency IS NULL AND (instrument_key = $${queryParams.length} OR instrument_key LIKE $${queryParams.length} || '-%')))`;
    }

    queryStr += ` FOR UPDATE`;

    const posRes = await client.query(queryStr, queryParams);
    const results: FundingPayment[] = [];

    if (posRes.rows.length === 0 && options.positionId) {
      const dupCheck = await client.query(
        `SELECT * FROM te_funding_payments WHERE position_id = $1 AND funding_timestamp = $2`,
        [options.positionId, fundingTimestamp]
      );
      if (dupCheck.rows.length > 0) {
        const row = dupCheck.rows[0];
        const existingPayment: FundingPayment = {
          fundingId: row.funding_id,
          positionId: row.position_id,
          userId: row.user_id,
          instrumentKey: row.instrument_key,
          currency: row.currency,
          side: row.side as 'Long' | 'Short',
          fundingRate: Number(row.funding_rate),
          fundingInterval: row.funding_interval,
          fundingTimestamp: Number(row.funding_timestamp),
          markPrice: Number(row.mark_price),
          qty: Number(row.qty),
          notional: Number(row.notional),
          fundingAmount: Number(row.funding_amount),
          status: row.status,
          createdAt: Number(row.created_at),
          processedAt: Number(row.processed_at),
        };

        if (options.currency && existingPayment.currency !== options.currency) {
          throw new Error(
            `Funding conflict: Existing funding payment currency (${existingPayment.currency}) does not match requested currency (${options.currency})`
          );
        }
        if (
          options.fundingRate != null &&
          Math.abs(existingPayment.fundingRate - options.fundingRate) > 1e-8
        ) {
          throw new Error(
            `Funding conflict: Existing funding rate (${existingPayment.fundingRate}) does not match requested rate (${options.fundingRate})`
          );
        }

        results.push(existingPayment);
      }
    }

    for (const posRow of posRes.rows) {
      const position = mapPosition(posRow);
      const posCurrency = position.collateralCurrency || position.settlementCurrency;
      if (
        !posCurrency ||
        String(posCurrency).trim() === '' ||
        posCurrency === 'undefined' ||
        posCurrency === 'null'
      ) {
        throw new Error(`Funding error: Position ${position.positionId} has missing currency`);
      }
      if (posCurrency !== 'TON' && posCurrency !== 'STARS') {
        throw new Error(
          `Funding error: Position ${position.positionId} has unsupported currency '${posCurrency}'`
        );
      }
      if (options.currency && options.currency !== posCurrency) {
        throw new Error(
          `Funding error: Position ${position.positionId} currency '${posCurrency}' does not match requested currency '${options.currency}'`
        );
      }

      if (options.fundingRate != null) {
        if (
          typeof options.fundingRate !== 'number' ||
          isNaN(options.fundingRate) ||
          !Number.isFinite(options.fundingRate)
        ) {
          throw new Error('Invalid fundingRate: must be a valid finite number');
        }
        if (Math.abs(options.fundingRate) > 1.0) {
          throw new Error(
            `Invalid fundingRate (${options.fundingRate}): exceeds maximum allowed range [-1.0, 1.0]`
          );
        }
      }

      // Lookup historical snapshot in te_funding_periods
      const snapshot = await getFundingPeriodSnapshot(
        pool,
        position.instrumentKey,
        posCurrency,
        fundingInterval,
        fundingTimestamp,
        client
      );

      let effectiveFundingRate: number;
      let effectiveMarkPrice: number;

      if (snapshot) {
        if (
          options.fundingRate != null &&
          Math.abs(snapshot.fundingRate - options.fundingRate) > 1e-8
        ) {
          throw new Error(
            `Funding conflict: Existing funding rate (${snapshot.fundingRate}) does not match requested rate (${options.fundingRate})`
          );
        }
        effectiveFundingRate = snapshot.fundingRate;
        effectiveMarkPrice = snapshot.markPrice;
      } else if (options.overrideMarkPrice != null && options.fundingRate != null) {
        effectiveFundingRate = options.fundingRate;
        effectiveMarkPrice = options.overrideMarkPrice;
        await createFundingPeriodSnapshot(
          pool,
          {
            instrumentKey: position.instrumentKey,
            currency: posCurrency,
            fundingInterval,
            fundingTimestamp,
            fundingRate: effectiveFundingRate,
            markPrice: effectiveMarkPrice,
          },
          client
        );
      } else if (!options.isCatchUp) {
        if (options.fundingRate == null) {
          throw new Error('Invalid fundingRate: must be a valid finite number');
        }
        effectiveFundingRate = options.fundingRate;
        effectiveMarkPrice =
          options.overrideMarkPrice != null
            ? options.overrideMarkPrice
            : position.markPrice != null && position.markPrice > 0
              ? position.markPrice
              : position.avgEntryPrice;
        await createFundingPeriodSnapshot(
          pool,
          {
            instrumentKey: position.instrumentKey,
            currency: posCurrency,
            fundingInterval,
            fundingTimestamp,
            fundingRate: effectiveFundingRate,
            markPrice: effectiveMarkPrice,
          },
          client
        );
      } else {
        throw new Error(
          `MISSING_HISTORICAL_SNAPSHOT: No funding period snapshot found for instrument '${position.instrumentKey}', currency '${posCurrency}', interval '${fundingInterval}', timestamp ${fundingTimestamp}`
        );
      }

      if (
        typeof effectiveFundingRate !== 'number' ||
        isNaN(effectiveFundingRate) ||
        !Number.isFinite(effectiveFundingRate)
      ) {
        throw new Error('Invalid fundingRate: must be a valid finite number');
      }

      if (Math.abs(effectiveFundingRate) > 1.0) {
        throw new Error(
          `Invalid fundingRate (${effectiveFundingRate}): exceeds maximum allowed range [-1.0, 1.0]`
        );
      }

      const fundingRate = Number(effectiveFundingRate.toFixed(8));
      const markPrice = effectiveMarkPrice;

      // Check if funding payment already exists for this position & timestamp (idempotency check)
      const dupCheck = await client.query(
        `SELECT * FROM te_funding_payments WHERE position_id = $1 AND funding_timestamp = $2`,
        [position.positionId, fundingTimestamp]
      );

      if (dupCheck.rows.length > 0) {
        const row = dupCheck.rows[0];
        const existingPayment: FundingPayment = {
          fundingId: row.funding_id,
          positionId: row.position_id,
          userId: row.user_id,
          instrumentKey: row.instrument_key,
          currency: row.currency,
          side: row.side as 'Long' | 'Short',
          fundingRate: Number(row.funding_rate),
          fundingInterval: row.funding_interval,
          fundingTimestamp: Number(row.funding_timestamp),
          markPrice: Number(row.mark_price),
          qty: Number(row.qty),
          notional: Number(row.notional),
          fundingAmount: Number(row.funding_amount),
          status: row.status,
          createdAt: Number(row.created_at),
          processedAt: Number(row.processed_at),
        };

        const currentQty = position.qty;
        const currentMarkPrice = markPrice;
        const currentCurrency = posCurrency;
        const currentRate = fundingRate;

        const rateDiff = Math.abs(existingPayment.fundingRate - currentRate);
        const priceDiff = Math.abs(existingPayment.markPrice - currentMarkPrice);
        const qtyDiff = Math.abs(existingPayment.qty - currentQty);
        const currencyMismatch = existingPayment.currency !== currentCurrency;

        if (rateDiff > 1e-8 || priceDiff > 1e-8 || qtyDiff > 1e-8 || currencyMismatch) {
          throw new Error(
            `Funding conflict: Existing funding payment for position ${position.positionId} at timestamp ${fundingTimestamp} has different parameters`
          );
        }

        results.push(existingPayment);
        continue;
      }

      // Do not process funding for positions opened after the funding timestamp
      if (position.openedAt && position.openedAt > fundingTimestamp) {
        continue;
      }

      let qty = position.qty;
      if (options.isCatchUp) {
        const posSnapshot = await getPositionSnapshotAt(
          position.positionId,
          fundingTimestamp,
          client,
          pool
        );
        if (posSnapshot) {
          qty = posSnapshot.qty;
          if (qty <= 0) continue; // Skip if position was closed at that time
        } else {
          throw new Error(
            `MISSING_HISTORICAL_QTY: No position snapshot found for position ${position.positionId} at timestamp ${fundingTimestamp}`
          );
        }
      }

      const notional = qty * markPrice;

      // Long pays when fundingRate > 0 (fundingAmount > 0)
      // Short receives when fundingRate > 0 (fundingAmount < 0)
      let fundingAmount = 0;
      if (position.side === 'Long') {
        fundingAmount = notional * fundingRate;
      } else {
        fundingAmount = -(notional * fundingRate);
      }

      // Lock & update user balance
      const balRes = await client.query(
        `SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
        [position.userId, posCurrency]
      );

      let currentBalance = 0;
      if (balRes.rows.length > 0) {
        currentBalance = Number(balRes.rows[0].available_balance);
      } else {
        await client.query(
          `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, updated_at) VALUES ($1, $2, $3, 0, $4)`,
          [position.userId, posCurrency, 0, Date.now()]
        );
      }

      let newAvailableBalance = currentBalance - fundingAmount;
      let paymentStatus: 'PROCESSED' | 'FAILED' = 'PROCESSED';
      let errorReason: string | undefined = undefined;

      if (newAvailableBalance < 0 && fundingAmount > 0) {
        paymentStatus = 'FAILED';
        errorReason = 'INSUFFICIENT_MARGIN';
        // Do not deduct partial sum, keep current balance
        newAvailableBalance = currentBalance;
      }

      if (paymentStatus === 'PROCESSED') {
        await client.query(
          `UPDATE te_balances SET available_balance = $1, updated_at = $2 WHERE user_id = $3 AND currency = $4`,
          [newAvailableBalance, Date.now(), position.userId, posCurrency]
        );
      } else if (paymentStatus === 'FAILED') {
        // Pass state to existing margin-call logic
        const newStatus = 'MarginCall';
        await client.query('UPDATE te_positions SET status = $1 WHERE position_id = $2', [
          newStatus,
          position.positionId,
        ]);
        await client.query(
          'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            'marginCall',
            position.userId,
            JSON.stringify({
              userId: position.userId,
              instrumentKey: position.instrumentKey,
              status: newStatus,
            }),
            'pending',
            posCurrency,
            Date.now(),
          ]
        );
      }

      const fundingId = 'funding_' + crypto.randomUUID();
      const nowMs = Date.now();

      await client.query(
        `INSERT INTO te_funding_payments 
          (funding_id, position_id, user_id, instrument_key, currency, side, funding_rate, funding_interval, funding_timestamp, mark_price, qty, notional, funding_amount, status, created_at, processed_at, error_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          fundingId,
          position.positionId,
          position.userId,
          position.instrumentKey,
          posCurrency,
          position.side,
          fundingRate,
          fundingInterval,
          fundingTimestamp,
          markPrice,
          qty,
          notional,
          fundingAmount,
          paymentStatus,
          nowMs,
          nowMs,
          errorReason || null,
        ]
      );

      const payment: FundingPayment = {
        fundingId,
        positionId: position.positionId,
        userId: position.userId,
        instrumentKey: position.instrumentKey,
        currency: posCurrency,
        side: position.side as 'Long' | 'Short',
        fundingRate,
        fundingInterval,
        fundingTimestamp,
        markPrice,
        qty,
        notional,
        fundingAmount,
        status: paymentStatus,
        errorReason,
        createdAt: nowMs,
        processedAt: nowMs,
      };

      const commonPayload = {
        userId: position.userId,
        positionId: position.positionId,
        instrumentKey: position.instrumentKey,
        side: position.side,
        currency: posCurrency,
        fundingRate,
        fundingAmount,
        fundingTimestamp,
        markPrice,
        availableBalance: newAvailableBalance,
        status: paymentStatus,
        errorReason,
      };

      // Outbox event: fundingUpdated
      await client.query(
        `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          'fundingUpdated',
          position.userId,
          JSON.stringify({ ...payment, ...commonPayload }),
          'pending',
          posCurrency,
          nowMs,
        ]
      );

      if (paymentStatus === 'PROCESSED') {
        // Outbox event: fundingProcessed (backwards compatibility)
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'fundingProcessed',
            position.userId,
            JSON.stringify({ ...payment, ...commonPayload }),
            'pending',
            posCurrency,
            nowMs,
          ]
        );

        // Outbox event: balanceUpdated
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'balanceUpdated',
            position.userId,
            JSON.stringify({
              ...commonPayload,
              previousBalance: currentBalance,
              availableBalance: newAvailableBalance,
            }),
            'pending',
            posCurrency,
            nowMs,
          ]
        );

        // Outbox event: ledgerUpdated
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'ledgerUpdated',
            position.userId,
            JSON.stringify({
              ...commonPayload,
              ledgerType: 'FUNDING',
              amount: fundingAmount,
            }),
            'pending',
            posCurrency,
            nowMs,
          ]
        );
      }

      // Outbox event: positionUpdated (only if position fields or financial snapshot changed)
      if (fundingAmount !== 0 || position.markPrice !== markPrice) {
        await client.query(
          `INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            'positionUpdated',
            position.userId,
            JSON.stringify({
              ...commonPayload,
              qty: position.qty,
              avgEntryPrice: position.avgEntryPrice,
              unrealizedPnl: position.unrealizedPnl,
              realizedPnl: position.realizedPnl,
              positionStatus: position.status,
            }),
            'pending',
            posCurrency,
            nowMs,
          ]
        );
      }

      results.push(payment);
    }

    if (ownClient) {
      await client.query('COMMIT');
    }

    return results;
  } catch (e) {
    if (ownClient) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
    }
    throw e;
  } finally {
    if (ownClient) {
      client.release();
    }
  }
}

export async function getFundingPayments(pool: Pool, userId: string): Promise<FundingPayment[]> {
  const res = await pool.query(
    `SELECT * FROM te_funding_payments WHERE user_id = $1 ORDER BY funding_timestamp DESC`,
    [userId]
  );
  return res.rows.map((r) => ({
    fundingId: r.funding_id,
    positionId: r.position_id,
    userId: r.user_id,
    instrumentKey: r.instrument_key,
    currency: r.currency,
    side: r.side,
    fundingRate: Number(r.funding_rate),
    fundingInterval: r.funding_interval,
    fundingTimestamp: Number(r.funding_timestamp),
    markPrice: Number(r.mark_price),
    qty: Number(r.qty),
    notional: Number(r.notional),
    fundingAmount: Number(r.funding_amount),
    status: r.status,
    createdAt: Number(r.created_at),
    processedAt: Number(r.processed_at),
    errorReason: r.error_reason || undefined,
  }));
}

export async function processMissedFundingPeriods(
  pool: Pool,
  options: {
    lastProcessedTimestamp?: number;
    currentTimestamp?: number;
    intervalMs: number;
    fundingRate?: number;
    overrideMarkPrice?: number;
    fundingInterval?: string;
    currency?: string;
    instrumentKey?: string;
  }
): Promise<
  {
    timestamp: number;
    payments: FundingPayment[];
    status?: 'PROCESSED' | 'SKIPPED';
    errorReason?: string;
  }[]
> {
  const endTs = options.currentTimestamp || Date.now();
  const intervalMs = options.intervalMs;
  if (intervalMs <= 0) {
    throw new Error('intervalMs must be positive');
  }

  const fundingInterval = options.fundingInterval || '8h';

  // 1. Fetch active open positions matching optional instrument/currency filters
  let queryStr = `SELECT * FROM te_positions WHERE status IN ('Open', 'MarginCall', 'OPEN', 'MARGIN_CALL') AND qty > 0`;
  const queryParams: any[] = [];

  if (options.instrumentKey) {
    queryParams.push(options.instrumentKey);
    queryStr += ` AND instrument_key = $${queryParams.length}`;
  }
  if (options.currency) {
    queryParams.push(options.currency);
    queryStr += ` AND (collateral_currency = $${queryParams.length} OR settlement_currency = $${queryParams.length})`;
  }

  const posRes = await pool.query(queryStr, queryParams);
  const openPositions = posRes.rows.map((r) => mapPosition(r));

  // Map timestamp -> array of positionIds that need funding at that timestamp
  const timestampToPositionsMap = new Map<number, string[]>();

  for (const pos of openPositions) {
    const posCurrency = pos.collateralCurrency || pos.settlementCurrency;
    if (!posCurrency || posCurrency === 'undefined' || posCurrency === 'null') {
      continue;
    }

    // Query max funding_timestamp specifically for this position_id, instrument_key, currency, and funding_interval
    const maxRes = await pool.query(
      `SELECT MAX(funding_timestamp) as max_ts
       FROM te_funding_payments
       WHERE position_id = $1
         AND instrument_key = $2
         AND currency = $3
         AND funding_interval = $4`,
      [pos.positionId, pos.instrumentKey, posCurrency, fundingInterval]
    );

    let posLastTs: number;
    if (maxRes.rows.length > 0 && maxRes.rows[0].max_ts != null) {
      posLastTs = Number(maxRes.rows[0].max_ts);
    } else if (options.lastProcessedTimestamp != null) {
      posLastTs = options.lastProcessedTimestamp;
    } else if (pos.openedAt != null && pos.openedAt < endTs) {
      posLastTs = pos.openedAt;
    } else {
      posLastTs = endTs - intervalMs;
    }

    let curTs = posLastTs + intervalMs;
    while (curTs <= endTs) {
      if (!timestampToPositionsMap.has(curTs)) {
        timestampToPositionsMap.set(curTs, []);
      }
      timestampToPositionsMap.get(curTs)!.push(pos.positionId);
      curTs += intervalMs;
    }
  }

  // Fallback if no open position needed funding but explicit lastProcessedTimestamp was provided
  if (timestampToPositionsMap.size === 0 && options.lastProcessedTimestamp != null) {
    let curTs = options.lastProcessedTimestamp + intervalMs;
    while (curTs <= endTs) {
      timestampToPositionsMap.set(curTs, []);
      curTs += intervalMs;
    }
  }

  // Get sorted discrete timestamps in strict chronological order
  const sortedTimestamps = Array.from(timestampToPositionsMap.keys()).sort((a, b) => a - b);
  const results: {
    timestamp: number;
    payments: FundingPayment[];
    status?: 'PROCESSED' | 'SKIPPED';
    errorReason?: string;
  }[] = [];

  for (const ts of sortedTimestamps) {
    const targetPosIds = timestampToPositionsMap.get(ts)!;
    const paymentsAtTs: FundingPayment[] = [];
    let periodStatus: 'PROCESSED' | 'SKIPPED' = 'PROCESSED';
    let periodErrorReason: string | undefined = undefined;

    if (targetPosIds.length === 0) {
      try {
        const payments = await applyFundingRate(pool, null, {
          fundingRate: options.fundingRate,
          overrideMarkPrice: options.overrideMarkPrice,
          fundingTimestamp: ts,
          fundingInterval,
          currency: options.currency,
          instrumentKey: options.instrumentKey,
          isCatchUp: true,
        });
        paymentsAtTs.push(...payments);
      } catch (err: any) {
        if (
          err.message &&
          (err.message.includes('MISSING_HISTORICAL_SNAPSHOT') ||
            err.message.includes('MISSING_HISTORICAL_QTY'))
        ) {
          periodStatus = 'SKIPPED';
          periodErrorReason = err.message;
        } else {
          throw err;
        }
      }
    } else {
      for (const posId of targetPosIds) {
        try {
          const payments = await applyFundingRate(pool, null, {
            fundingRate: options.fundingRate,
            overrideMarkPrice: options.overrideMarkPrice,
            fundingTimestamp: ts,
            fundingInterval,
            currency: options.currency,
            instrumentKey: options.instrumentKey,
            positionId: posId,
            isCatchUp: true,
          });
          paymentsAtTs.push(...payments);
        } catch (err: any) {
          if (
            err.message &&
            (err.message.includes('MISSING_HISTORICAL_SNAPSHOT') ||
              err.message.includes('MISSING_HISTORICAL_QTY'))
          ) {
            periodStatus = 'SKIPPED';
            periodErrorReason = err.message;
          } else {
            throw err;
          }
        }
      }
    }

    results.push({
      timestamp: ts,
      payments: paymentsAtTs,
      status: periodStatus,
      errorReason: periodErrorReason,
    });
  }

  return results;
}

export class FundingWorker {
  private engine: {
    processMissedFundingPeriods: (opts: any) => Promise<any>;
    applyFundingRate: (client: any, opts: any) => Promise<any>;
  };
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private fundingRateProvider: () => number;

  constructor(
    engine: {
      processMissedFundingPeriods: (opts: any) => Promise<any>;
      applyFundingRate: (client: any, opts: any) => Promise<any>;
    },
    options?: { intervalMs?: number; fundingRateProvider?: () => number }
  ) {
    this.engine = engine;
    this.intervalMs = options?.intervalMs ?? 28800000; // default 8h
    this.fundingRateProvider = options?.fundingRateProvider ?? (() => 0.0001);
  }

  public async start(catchUp: boolean = true): Promise<void> {
    if (this.isRunning) {
      console.log('FundingWorker is already running. Skipping duplicate start.');
      return;
    }
    this.isRunning = true;

    if (catchUp) {
      try {
        await this.engine.processMissedFundingPeriods({
          intervalMs: this.intervalMs,
          fundingRate: this.fundingRateProvider(),
        });
      } catch (err) {
        console.error('Error during funding catch-up on start:', err);
      }
    }

    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const rate = this.fundingRateProvider();
        await this.engine.applyFundingRate(null, {
          fundingRate: rate,
          fundingTimestamp: Date.now(),
        });
      } catch (err) {
        console.error('Error during scheduled funding execution:', err);
      }
    }, this.intervalMs);
  }

  public async tick(overrideTimestamp?: number): Promise<FundingPayment[]> {
    if (!this.isRunning) {
      throw new Error('FundingWorker is not running');
    }
    const rate = this.fundingRateProvider();
    return await this.engine.applyFundingRate(null, {
      fundingRate: rate,
      fundingTimestamp: overrideTimestamp || Date.now(),
    });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public getStatus(): { isRunning: boolean; intervalMs: number } {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
    };
  }
}
