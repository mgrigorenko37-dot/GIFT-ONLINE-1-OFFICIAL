import { Pool, PoolClient } from 'pg';
import { gifts } from '../src/data/gifts';

export interface CurrencyResolutionResult {
  currency: string | null;
  isUnresolvable: boolean;
  reason?: string;
}

/**
 * Documented Rules for Instrument Currency Resolution:
 * 1. Known TON instruments: 'TON', 'TON-USDT', or any registered Telegram gift ID.
 * 2. Known STARS instruments: 'STARS', 'STARS-USDT', 'star', 'star:all:all:STARS'.
 * 3. Structured key format 'collection:model:backdrop:currency':
 *    - If currency segment is 'STARS' -> 'STARS'.
 *    - If currency segment is 'TON' -> 'TON'.
 * 4. Regex / Substring rule:
 *    - Key ending with or containing ':STARS' or '-STARS' -> 'STARS'.
 *    - Key ending with or containing ':TON' or '-TON' -> 'TON'.
 * 5. Unrecognized / Unknown instrument keys:
 *    - DO NOT silently default to TON. Return isUnresolvable: true.
 */
export function resolveInstrumentCurrency(
  instrumentKey: string | null | undefined
): CurrencyResolutionResult {
  if (!instrumentKey || typeof instrumentKey !== 'string' || instrumentKey.trim() === '') {
    return { currency: null, isUnresolvable: true, reason: 'Instrument key is missing or empty' };
  }

  const key = instrumentKey.trim();

  // Rule 1: Known STARS instruments
  if (key === 'STARS' || key === 'STARS-USDT' || key === 'star' || key === 'star:all:all:STARS') {
    return { currency: 'STARS', isUnresolvable: false };
  }

  // Rule 2: Known TON instruments
  if (key === 'TON' || key === 'TON-USDT') {
    return { currency: 'TON', isUnresolvable: false };
  }

  // Known Telegram Gift IDs
  for (const gift of gifts) {
    if (key === gift.id || key === `${gift.id}:all:all:TON`) {
      return { currency: 'TON', isUnresolvable: false };
    }
  }

  // Rule 3: Structured colon keys (collection:model:backdrop:currency)
  if (key.includes(':')) {
    const parts = key.split(':');
    const lastPart = parts[parts.length - 1].toUpperCase();
    if (lastPart === 'STARS') {
      return { currency: 'STARS', isUnresolvable: false };
    }
    if (lastPart === 'TON') {
      return { currency: 'TON', isUnresolvable: false };
    }
  }

  // Rule 4: Substring / pattern matching
  const upperKey = key.toUpperCase();
  if (upperKey.endsWith(':STARS') || upperKey.endsWith('-STARS') || upperKey.includes('STARS')) {
    return { currency: 'STARS', isUnresolvable: false };
  }
  if (upperKey.endsWith(':TON') || upperKey.endsWith('-TON') || upperKey.includes('TON')) {
    return { currency: 'TON', isUnresolvable: false };
  }

  // Rule 5: Unknown instrument key according to documented rules
  return {
    currency: null,
    isUnresolvable: true,
    reason: `Instrument key "${key}" does not match any documented TON or STARS currency rule`,
  };
}

export interface MigrationOptions {
  strictMode?: boolean; // If true (default), throw a controlled error on unresolvable keys
}

export interface MigrationSummary {
  migratedBalances: number;
  migratedOrders: number;
  migratedPositions: number;
  migratedTrades: number;
  migratedExecutions: number;
  migratedOutboxEvents: number;
  unresolvedCount: number;
  unresolvedRecords: Array<{ table: string; id: string; instrumentKey: string; reason?: string }>;
}

/**
 * Safe Migration for te_balances and instrument currencies across trading tables.
 */
export async function migrateBalancesAndCurrencies(
  pool: Pool,
  options: MigrationOptions = { strictMode: true }
): Promise<MigrationSummary> {
  const client = await pool.connect();
  const summary: MigrationSummary = {
    migratedBalances: 0,
    migratedOrders: 0,
    migratedPositions: 0,
    migratedTrades: 0,
    migratedExecutions: 0,
    migratedOutboxEvents: 0,
    unresolvedCount: 0,
    unresolvedRecords: [],
  };

  try {
    await client.query('BEGIN');

    // Ensure search_path
    try {
      await client.query('SET search_path TO public');
    } catch (e) {}

    // Helper to safely execute queries with savepoints
    const safeQuery = async (queryText: string, params: any[] = []) => {
      const spName = 'sp_' + Math.random().toString(36).substring(2, 9);
      await client.query(`SAVEPOINT ${spName}`);
      try {
        const res = await client.query(queryText, params);
        return res;
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${spName}`);
        return null;
      }
    };

    // --- STEP 1: Migrate te_balances safely ---
    await safeQuery(
      `ALTER TABLE te_balances ADD COLUMN IF NOT EXISTS currency VARCHAR(20) DEFAULT 'TON'`
    );
    await safeQuery(`ALTER TABLE te_balances ALTER COLUMN currency SET DEFAULT 'TON'`);

    // Update null or empty currency values to 'TON' (preserving existing legacy balance)
    const updateBalRes = await safeQuery(`
      UPDATE te_balances 
      SET currency = 'TON' 
      WHERE currency IS NULL OR currency = ''
    `);
    if (updateBalRes) {
      summary.migratedBalances = updateBalRes.rowCount || 0;
    }

    // Try updating primary key on te_balances to (user_id, currency) if it wasn't already
    await safeQuery(`
      DO $$
      DECLARE
        pk_name TEXT;
        col_count INT;
      BEGIN
        SELECT tc.constraint_name, COUNT(kcu.column_name) 
        INTO pk_name, col_count
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name 
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = 'te_balances' 
          AND tc.constraint_type = 'PRIMARY KEY'
        GROUP BY tc.constraint_name;

        IF pk_name IS NOT NULL AND col_count = 1 THEN
          EXECUTE 'ALTER TABLE te_balances DROP CONSTRAINT ' || pk_name;
          EXECUTE 'ALTER TABLE te_balances ADD PRIMARY KEY (user_id, currency)';
        ELSIF pk_name IS NULL THEN
          EXECUTE 'ALTER TABLE te_balances ADD PRIMARY KEY (user_id, currency)';
        END IF;
      END $$;
    `);

    // --- STEP 2: Ensure currency columns exist on all trading tables ---
    const alterStatements = [
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',

      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',

      'ALTER TABLE te_trades ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_trades ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
      'ALTER TABLE te_trades ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',

      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',

      'ALTER TABLE te_outbox_events ADD COLUMN IF NOT EXISTS currency VARCHAR(32)',
    ];

    for (const stmt of alterStatements) {
      await safeQuery(stmt);
    }

    // --- STEP 3: Process existing rows needing currency resolution ---

    // 3a. Process te_orders
    const unassignedOrders = await safeQuery(`
      SELECT order_id, instrument_key 
      FROM te_orders 
      WHERE settlement_currency IS NULL OR settlement_currency = ''
    `);

    if (unassignedOrders && unassignedOrders.rows) {
      for (const row of unassignedOrders.rows) {
        const res = resolveInstrumentCurrency(row.instrument_key);
        if (res.isUnresolvable || !res.currency) {
          summary.unresolvedCount++;
          summary.unresolvedRecords.push({
            table: 'te_orders',
            id: row.order_id,
            instrumentKey: row.instrument_key,
            reason: res.reason,
          });
          if (!options.strictMode) {
            await safeQuery(
              `
              UPDATE te_orders 
              SET status = 'Rejected', rejection_reason = 'UNRESOLVED_CURRENCY_REQUIRES_MANUAL_REVIEW'
              WHERE order_id = $1
            `,
              [row.order_id]
            );
          }
        } else {
          await safeQuery(
            `
            UPDATE te_orders 
            SET settlement_currency = $1, fee_currency = $1, pnl_currency = $1, collateral_currency = $1
            WHERE order_id = $2
          `,
            [res.currency, row.order_id]
          );
          summary.migratedOrders++;
        }
      }
    }

    // 3b. Process te_positions
    const unassignedPositions = await safeQuery(`
      SELECT position_id, instrument_key 
      FROM te_positions 
      WHERE settlement_currency IS NULL OR settlement_currency = ''
    `);

    if (unassignedPositions && unassignedPositions.rows) {
      for (const row of unassignedPositions.rows) {
        const res = resolveInstrumentCurrency(row.instrument_key);
        if (res.isUnresolvable || !res.currency) {
          summary.unresolvedCount++;
          summary.unresolvedRecords.push({
            table: 'te_positions',
            id: row.position_id,
            instrumentKey: row.instrument_key,
            reason: res.reason,
          });
        } else {
          await safeQuery(
            `
            UPDATE te_positions 
            SET settlement_currency = $1, pnl_currency = $1, collateral_currency = $1
            WHERE position_id = $2
          `,
            [res.currency, row.position_id]
          );
          summary.migratedPositions++;
        }
      }
    }

    // 3c. Process te_trades
    const unassignedTrades = await safeQuery(`
      SELECT trade_id, instrument_key 
      FROM te_trades 
      WHERE settlement_currency IS NULL OR settlement_currency = ''
    `);

    if (unassignedTrades && unassignedTrades.rows) {
      for (const row of unassignedTrades.rows) {
        const res = resolveInstrumentCurrency(row.instrument_key);
        if (res.isUnresolvable || !res.currency) {
          summary.unresolvedCount++;
          summary.unresolvedRecords.push({
            table: 'te_trades',
            id: row.trade_id,
            instrumentKey: row.instrument_key,
            reason: res.reason,
          });
        } else {
          await safeQuery(
            `
            UPDATE te_trades 
            SET settlement_currency = $1, fee_currency = $1, pnl_currency = $1
            WHERE trade_id = $2
          `,
            [res.currency, row.trade_id]
          );
          summary.migratedTrades++;
        }
      }
    }

    // 3d. Process te_executions
    const unassignedExecs = await safeQuery(`
      SELECT execution_id, instrument_key 
      FROM te_executions 
      WHERE settlement_currency IS NULL OR settlement_currency = ''
    `);

    if (unassignedExecs && unassignedExecs.rows) {
      for (const row of unassignedExecs.rows) {
        const res = resolveInstrumentCurrency(row.instrument_key);
        if (res.isUnresolvable || !res.currency) {
          summary.unresolvedCount++;
          summary.unresolvedRecords.push({
            table: 'te_executions',
            id: row.execution_id,
            instrumentKey: row.instrument_key,
            reason: res.reason,
          });
        } else {
          await safeQuery(
            `
            UPDATE te_executions 
            SET settlement_currency = $1, fee_currency = $1, pnl_currency = $1
            WHERE execution_id = $2
          `,
            [res.currency, row.execution_id]
          );
          summary.migratedExecutions++;
        }
      }
    }

    // 3e. Process te_outbox_events
    const unassignedOutbox = await safeQuery(`
      SELECT id, payload 
      FROM te_outbox_events 
      WHERE currency IS NULL OR currency = ''
    `);

    if (unassignedOutbox && unassignedOutbox.rows) {
      for (const row of unassignedOutbox.rows) {
        let instKey = '';
        try {
          const payloadObj = JSON.parse(row.payload);
          instKey = payloadObj.instrumentKey || payloadObj.currency || '';
        } catch (e) {}

        const res = resolveInstrumentCurrency(instKey);
        if (res.isUnresolvable || !res.currency) {
          summary.unresolvedCount++;
          summary.unresolvedRecords.push({
            table: 'te_outbox_events',
            id: String(row.id),
            instrumentKey: instKey,
            reason: res.reason,
          });
        } else {
          await safeQuery(
            `
            UPDATE te_outbox_events 
            SET currency = $1
            WHERE id = $2
          `,
            [res.currency, row.id]
          );
          summary.migratedOutboxEvents++;
        }
      }
    }

    // If strictMode is enabled and there are unresolved records, throw a controlled error!
    if (options.strictMode && summary.unresolvedCount > 0) {
      const details = summary.unresolvedRecords
        .map((r) => `[Table: ${r.table}, ID: ${r.id}, Key: "${r.instrumentKey}"]`)
        .join(', ');
      throw new Error(
        `Controlled Currency Migration Error: Unable to determine currency for ${summary.unresolvedCount} record(s): ${details}. Manual review required.`
      );
    }

    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
