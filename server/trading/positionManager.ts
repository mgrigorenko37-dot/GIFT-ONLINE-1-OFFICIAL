import { Pool, PoolClient } from 'pg';
import { Position, Trade, PositionSnapshot } from './types';
import { mapPosition, mapTrade } from './mappers';
import { calculateMargin } from './balanceManager';
import * as crypto from 'crypto';

export async function getAllPositions(pool: Pool, userId: string): Promise<Position[]> {
  const res = await pool.query('SELECT * FROM te_positions WHERE user_id = $1', [userId]);
  return res.rows.map((r) => mapPosition(r));
}

export async function getUserTrades(pool: Pool, userId: string): Promise<Trade[]> {
  const res = await pool.query(
    'SELECT * FROM te_trades WHERE user_id = $1 ORDER BY timestamp DESC',
    [userId]
  );
  return res.rows.map((r) => mapTrade(r));
}

export async function recordPositionSnapshot(
  position: {
    positionId: string;
    userId: string;
    instrumentKey: string;
    side: 'Long' | 'Short' | string;
    qty: number;
    avgEntryPrice: number;
    status: string;
    settlementCurrency?: string;
    collateralCurrency?: string;
  },
  validFrom?: number,
  validTo?: number | null,
  clientArg?: PoolClient | any,
  pool?: Pool
): Promise<PositionSnapshot> {
  const client = clientArg || (await pool!.connect());
  const ownClient = !clientArg;
  try {
    const nowMs = validFrom ?? Date.now();
    const snapshotId = 'pos_snap_' + crypto.randomUUID();

    // Close previous snapshot for this position where valid_to IS NULL and valid_from < nowMs
    await client.query(
      `UPDATE te_position_snapshots
       SET valid_to = $1
       WHERE position_id = $2 AND valid_to IS NULL AND valid_from < $1`,
      [nowMs, position.positionId]
    );

    // Insert new snapshot
    await client.query(
      `INSERT INTO te_position_snapshots
        (snapshot_id, position_id, user_id, instrument_key, side, qty, avg_entry_price, status, settlement_currency, collateral_currency, valid_from, valid_to, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        snapshotId,
        position.positionId,
        position.userId,
        position.instrumentKey,
        position.side,
        position.qty,
        position.avgEntryPrice,
        position.status,
        position.settlementCurrency || null,
        position.collateralCurrency || null,
        nowMs,
        validTo ?? null,
        Date.now(),
      ]
    );

    return {
      snapshotId,
      positionId: position.positionId,
      userId: position.userId,
      instrumentKey: position.instrumentKey,
      side: position.side as 'Long' | 'Short',
      qty: position.qty,
      avgEntryPrice: position.avgEntryPrice,
      status: position.status,
      settlementCurrency: position.settlementCurrency,
      collateralCurrency: position.collateralCurrency,
      validFrom: nowMs,
      validTo: validTo ?? null,
      createdAt: Date.now(),
    };
  } finally {
    if (ownClient) {
      client.release();
    }
  }
}

export async function getPositionSnapshotAt(
  positionId: string,
  timestamp: number,
  clientArg?: PoolClient | any,
  pool?: Pool
): Promise<PositionSnapshot | null> {
  const client = clientArg || (await pool!.connect());
  const ownClient = !clientArg;
  try {
    const res = await client.query(
      `SELECT * FROM te_position_snapshots
       WHERE position_id = $1
         AND valid_from <= $2
         AND (valid_to IS NULL OR valid_to > $2)
       ORDER BY valid_from DESC
       LIMIT 1`,
      [positionId, timestamp]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      snapshotId: row.snapshot_id,
      positionId: row.position_id,
      userId: row.user_id,
      instrumentKey: row.instrument_key,
      side: row.side as 'Long' | 'Short',
      qty: Number(row.qty),
      avgEntryPrice: Number(row.avg_entry_price),
      status: row.status,
      settlementCurrency: row.settlement_currency || undefined,
      collateralCurrency: row.collateral_currency || undefined,
      validFrom: Number(row.valid_from),
      validTo: row.valid_to ? Number(row.valid_to) : null,
      createdAt: Number(row.created_at),
    };
  } finally {
    if (ownClient) {
      client.release();
    }
  }
}

export async function updateMarkPrice(
  pool: Pool,
  instrumentKey: string,
  markPrice: number,
  liquidateUserFn: (client: PoolClient | any, userId: string, currency: string) => Promise<any>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const posRes = await client.query(
      "SELECT * FROM te_positions WHERE instrument_key = $1 AND status IN ('Open', 'MarginCall') FOR UPDATE",
      [instrumentKey]
    );

    const liquidatedUsers = new Set<string>();

    for (const row of posRes.rows) {
      const position = mapPosition(row);

      if (liquidatedUsers.has(position.userId)) continue;

      // 2. Обновить markPrice.
      position.markPrice = markPrice;

      // 3. Пересчитать unrealizedPnl.
      const pnlMultiplier = position.side === 'Long' ? 1 : -1;
      position.unrealizedPnl = (markPrice - position.avgEntryPrice) * position.qty * pnlMultiplier;

      // 4. Записать изменения в PostgreSQL BEFORE calculateMargin so it uses updated values
      await client.query(
        'UPDATE te_positions SET mark_price = $1, unrealized_pnl = $2 WHERE position_id = $3',
        [position.markPrice, position.unrealizedPnl, position.positionId]
      );

      // Пересчитать equity и margin state.
      const marginInfo = await calculateMargin(
        client,
        position.userId,
        position.collateralCurrency
      );

      // 5. Определить:
      // достаточно ли маржи;
      // нужен ли MARGIN_CALL;
      // нужна ли liquidation.
      let newStatus = position.status;
      let isLiquidationNeeded = false;

      if (marginInfo.equity <= marginInfo.maintenanceMargin && marginInfo.maintenanceMargin > 0) {
        isLiquidationNeeded = true;
      } else if (marginInfo.equity < marginInfo.usedMargin) {
        newStatus = 'MarginCall';
      } else {
        newStatus = 'Open';
      }

      if (isLiquidationNeeded) {
        // We do liquidation
        await liquidateUserFn(client, position.userId, position.collateralCurrency);
        liquidatedUsers.add(position.userId);
        continue;
      }

      if (newStatus !== position.status) {
        position.status = newStatus as any;
        await client.query('UPDATE te_positions SET status = $1 WHERE position_id = $2', [
          newStatus,
          position.positionId,
        ]);
        if (newStatus === 'MarginCall') {
          await client.query(
            'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [
              'marginCall',
              position.userId,
              JSON.stringify({
                userId: position.userId,
                instrumentKey: position.instrumentKey,
                status: 'MarginCall',
              }),
              'pending',
              position.settlementCurrency,
              Date.now(),
            ]
          );
        }
      }

      // 7. Создать outbox event в той же транзакции.
      await client.query('SAVEPOINT insert_outbox_mark_sp');
      try {
        await client.query(
          'INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            'positionUpdated',
            position.userId,
            JSON.stringify(position),
            'pending',
            position.settlementCurrency,
            Date.now(),
          ]
        );
      } catch (e: any) {
        try {
          await client.query('ROLLBACK TO SAVEPOINT insert_outbox_mark_sp');
        } catch (e) {}
        await client.query(
          'INSERT INTO te_outbox_events (event_type, user_id, payload, status, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['positionUpdated', position.userId, JSON.stringify(position), 'pending', Date.now()]
        );
      }
    }

    // 8. Выполнить commit.
    await client.query('COMMIT');
  } catch (e) {
    console.error('Error in updateMarkPrice', e);
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
  } finally {
    client.release();
  }
}
