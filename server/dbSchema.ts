import { Pool, PoolClient } from 'pg';

export const SCHEMA_LOCK_NAMESPACE = 1048576;
export const SCHEMA_LOCK_KEY = 739201;

export interface MigrationDefinition {
  id: string;
  name: string;
  up: (client: PoolClient) => Promise<void>;
}

export interface SchemaInitResult {
  appliedCount: number;
  currentVersion: string | null;
  appliedMigrations: string[];
}

export class SchemaMigrationError extends Error {
  public migrationId?: string;
  public originalError: any;

  constructor(message: string, migrationId?: string, originalError?: any) {
    super(message);
    this.name = 'SchemaMigrationError';
    this.migrationId = migrationId;
    this.originalError = originalError;
  }
}

/**
 * List of ordered migrations forming the full Enterprise Schema for GX Exchange.
 */
export const MIGRATIONS: MigrationDefinition[] = [
  {
    id: '001_core_trading_schema',
    name: 'Core Trading Engine Tables (Users, Balances, Orders, Trades, Executions, Positions)',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS te_users (
          id VARCHAR(255) PRIMARY KEY,
          wallet_address VARCHAR(255)
        );

        CREATE TABLE IF NOT EXISTS te_balances (
          user_id VARCHAR(255),
          currency VARCHAR(32) DEFAULT 'TON',
          available_balance NUMERIC NOT NULL CHECK (available_balance >= 0),
          locked_balance NUMERIC NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
          realized_pnl NUMERIC NOT NULL DEFAULT 0,
          total_fees NUMERIC NOT NULL DEFAULT 0,
          updated_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, currency)
        );

        CREATE TABLE IF NOT EXISTS te_orders (
          order_id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          instrument_key VARCHAR(255) NOT NULL,
          side VARCHAR(32) NOT NULL,
          order_type VARCHAR(20) NOT NULL,
          qty NUMERIC NOT NULL,
          price NUMERIC NOT NULL,
          reduce_only BOOLEAN NOT NULL DEFAULT false,
          position_effect VARCHAR(32),
          rejection_reason TEXT,
          status VARCHAR(20) NOT NULL,
          executed_qty NUMERIC NOT NULL DEFAULT 0,
          remaining_qty NUMERIC NOT NULL,
          avg_fill_price NUMERIC NOT NULL DEFAULT 0,
          fee NUMERIC NOT NULL DEFAULT 0,
          settlement_currency VARCHAR(32),
          fee_currency VARCHAR(32),
          pnl_currency VARCHAR(32),
          collateral_currency VARCHAR(32),
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS te_trades (
          trade_id VARCHAR(255) PRIMARY KEY,
          order_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          instrument_key VARCHAR(255) NOT NULL,
          side VARCHAR(32) NOT NULL,
          qty NUMERIC NOT NULL,
          price NUMERIC NOT NULL,
          fee NUMERIC NOT NULL,
          settlement_currency VARCHAR(32),
          fee_currency VARCHAR(32),
          pnl_currency VARCHAR(32),
          realized_pnl NUMERIC NOT NULL DEFAULT 0,
          timestamp BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS te_executions (
          execution_id VARCHAR(255) PRIMARY KEY,
          order_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          instrument_key VARCHAR(255) NOT NULL,
          side VARCHAR(32) NOT NULL,
          requested_qty NUMERIC NOT NULL,
          fill_qty NUMERIC NOT NULL,
          fill_price NUMERIC NOT NULL,
          fee NUMERIC NOT NULL,
          status VARCHAR(20) NOT NULL,
          settlement_currency VARCHAR(32),
          fee_currency VARCHAR(32),
          pnl_currency VARCHAR(32),
          created_at BIGINT NOT NULL,
          processed_at BIGINT NOT NULL,
          source VARCHAR(50),
          external_execution_id VARCHAR(255)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS te_executions_source_ext_idx 
        ON te_executions(source, external_execution_id) 
        WHERE source IS NOT NULL AND external_execution_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS te_positions (
          position_id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          instrument_key VARCHAR(255) NOT NULL,
          side VARCHAR(32) NOT NULL,
          qty NUMERIC NOT NULL,
          avg_entry_price NUMERIC NOT NULL,
          mark_price NUMERIC NOT NULL DEFAULT 0,
          unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
          realized_pnl NUMERIC NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL,
          settlement_currency VARCHAR(32),
          pnl_currency VARCHAR(32),
          collateral_currency VARCHAR(32),
          opened_at BIGINT DEFAULT 0,
          created_at BIGINT DEFAULT 0,
          updated_at BIGINT DEFAULT 0,
          liquidation_timestamp BIGINT,
          liquidation_reason TEXT,
          UNIQUE(user_id, instrument_key)
        );
      `);
    },
  },
  {
    id: '002_outbox_and_deposits',
    name: 'Transactional Outbox and TON Deposit Scanner Tables',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS te_outbox_events (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          payload TEXT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          currency VARCHAR(32),
          created_at BIGINT NOT NULL,
          published_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS te_ton_deposits (
          hash VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          sender_address VARCHAR(255),
          amount NUMERIC NOT NULL,
          lt BIGINT,
          status VARCHAR(50) DEFAULT 'credited',
          reason TEXT,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS te_ton_scanner_cursor (
          id VARCHAR(50) PRIMARY KEY,
          last_lt BIGINT NOT NULL DEFAULT 0,
          last_hash VARCHAR(255),
          updated_at BIGINT NOT NULL
        );
      `);
    },
  },
  {
    id: '003_withdrawals_and_audits',
    name: 'Withdrawal Engine with Idempotency and Financial Audit Log',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS te_withdrawals (
          id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          amount NUMERIC NOT NULL,
          currency VARCHAR(32) NOT NULL DEFAULT 'TON',
          address VARCHAR(255) NOT NULL,
          operation_id VARCHAR(255) UNIQUE,
          status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'RETRYING', 'COMPLETED', 'FAILED', 'NEEDS_RECONCILIATION')),
          tx_hash VARCHAR(255),
          failure_reason TEXT,
          attempts INT NOT NULL DEFAULT 0,
          next_attempt_at BIGINT,
          locked_at BIGINT,
          processed_at BIGINT,
          worker_id VARCHAR(255),
          funds_released_at BIGINT,
          funds_released BOOLEAN NOT NULL DEFAULT FALSE,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS te_withdrawals_operation_id_idx 
        ON te_withdrawals (operation_id) 
        WHERE operation_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS te_financial_audits (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          reference_id VARCHAR(255) NOT NULL,
          currency VARCHAR(32) DEFAULT 'TON',
          amount NUMERIC NOT NULL,
          available_before NUMERIC NOT NULL,
          available_after NUMERIC NOT NULL,
          locked_before NUMERIC NOT NULL,
          locked_after NUMERIC NOT NULL,
          metadata TEXT,
          created_at BIGINT NOT NULL
        );
      `);
    },
  },
  {
    id: '004_funding_and_snapshots',
    name: 'Perpetual Funding Rate Settlement and Position Snapshots',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS te_funding_payments (
          funding_id VARCHAR(255) PRIMARY KEY,
          position_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          instrument_key VARCHAR(255) NOT NULL,
          currency VARCHAR(32) NOT NULL,
          side VARCHAR(32) NOT NULL,
          funding_rate NUMERIC NOT NULL,
          funding_interval VARCHAR(32) NOT NULL DEFAULT '8h',
          funding_timestamp BIGINT NOT NULL,
          mark_price NUMERIC NOT NULL,
          qty NUMERIC NOT NULL,
          notional NUMERIC NOT NULL,
          funding_amount NUMERIC NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'PROCESSED',
          created_at BIGINT NOT NULL,
          processed_at BIGINT NOT NULL,
          error_reason TEXT,
          CONSTRAINT te_funding_pos_ts_unique UNIQUE(position_id, instrument_key, currency, funding_interval, funding_timestamp)
        );

        CREATE TABLE IF NOT EXISTS te_funding_periods (
          instrument_key VARCHAR(255) NOT NULL,
          currency VARCHAR(32) NOT NULL,
          funding_interval VARCHAR(32) NOT NULL DEFAULT '8h',
          funding_timestamp BIGINT NOT NULL,
          funding_rate NUMERIC NOT NULL,
          mark_price NUMERIC NOT NULL,
          created_at BIGINT NOT NULL,
          CONSTRAINT te_funding_periods_pk PRIMARY KEY (instrument_key, currency, funding_interval, funding_timestamp)
        );

        CREATE TABLE IF NOT EXISTS te_position_snapshots (
          snapshot_id VARCHAR(255) PRIMARY KEY,
          position_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          instrument_key VARCHAR(255) NOT NULL,
          currency VARCHAR(32) NOT NULL,
          side VARCHAR(32) NOT NULL,
          qty NUMERIC NOT NULL,
          status VARCHAR(32) NOT NULL,
          avg_entry_price NUMERIC NOT NULL,
          valid_from BIGINT NOT NULL,
          valid_to BIGINT,
          created_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS te_pos_snap_pos_time_idx ON te_position_snapshots(position_id, valid_from, valid_to);
      `);
    },
  },
  {
    id: '005_telegram_stars_invoices_and_payments',
    name: 'Telegram Stars Invoices and Payments with Strict Isolation',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS te_invoices (
          id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          stars_amount NUMERIC NOT NULL,
          currency VARCHAR(32) NOT NULL DEFAULT 'XTR',
          payload TEXT NOT NULL,
          nonce VARCHAR(255) NOT NULL,
          idempotency_key VARCHAR(255),
          status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
          invoice_link TEXT,
          telegram_payment_charge_id VARCHAR(255),
          telegram_provider_charge_id VARCHAR(255),
          failure_reason TEXT,
          created_at BIGINT NOT NULL,
          paid_at BIGINT,
          updated_at BIGINT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_te_invoices_nonce_unique ON te_invoices(nonce);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_te_invoices_idem_user_unique ON te_invoices(idempotency_key, user_id) WHERE idempotency_key IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_te_invoices_charge_id_unique ON te_invoices(telegram_payment_charge_id) WHERE telegram_payment_charge_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_te_invoices_user_id ON te_invoices(user_id);

        CREATE TABLE IF NOT EXISTS te_payments (
          id VARCHAR(255) PRIMARY KEY,
          invoice_id VARCHAR(255) REFERENCES te_invoices(id),
          user_id VARCHAR(255) NOT NULL,
          amount NUMERIC NOT NULL,
          currency VARCHAR(32) NOT NULL,
          telegram_payment_charge_id VARCHAR(255) NOT NULL,
          telegram_provider_charge_id VARCHAR(255),
          status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
          created_at BIGINT NOT NULL,
          CONSTRAINT te_payments_charge_id_unique UNIQUE(telegram_payment_charge_id)
        );

        CREATE INDEX IF NOT EXISTS idx_te_payments_user_id ON te_payments(user_id);
      `);
    },
  },
  {
    id: '006_gifts_catalog',
    name: 'Telegram Gifts Collections and Variants Catalog',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS gift_collections (
          id VARCHAR(255) PRIMARY KEY,
          name TEXT NOT NULL,
          total_supply NUMERIC,
          image_url TEXT,
          floor_price_gx NUMERIC,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_collections_id_unique ON gift_collections(id);

        CREATE TABLE IF NOT EXISTS gift_variants (
          id VARCHAR(255) PRIMARY KEY,
          collection_id VARCHAR(255) REFERENCES gift_collections(id) ON DELETE CASCADE,
          model_name TEXT,
          backdrop_color TEXT,
          symbol_name TEXT,
          rarity_percentage NUMERIC,
          current_price_gx NUMERIC,
          image_url TEXT,
          last_synced_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_gift_variants_collection ON gift_variants(collection_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_variants_id_unique ON gift_variants(id);
      `);
    },
  },
  {
    id: '007_market_repository_and_leases',
    name: 'Market Repository OHLCV, Sales, Snapshots, Outbox and Scheduler Leases',
    up: async (client: PoolClient) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS completed_sales (
          sale_id TEXT PRIMARY KEY,
          dedupe_key TEXT UNIQUE NOT NULL,
          collection_id TEXT NOT NULL,
          gift_id TEXT,
          model_id TEXT,
          backdrop_id TEXT,
          currency TEXT NOT NULL,
          instrument_key TEXT NOT NULL,
          price NUMERIC NOT NULL,
          quantity NUMERIC NOT NULL,
          event_time BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          status TEXT NOT NULL,
          transaction_hash TEXT,
          source TEXT NOT NULL DEFAULT 'real',
          simulation BOOLEAN NOT NULL DEFAULT false,
          inserted_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS candles (
          instrument_key TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          start_time BIGINT NOT NULL,
          end_time BIGINT NOT NULL,
          open NUMERIC NOT NULL,
          high NUMERIC NOT NULL,
          low NUMERIC NOT NULL,
          close NUMERIC NOT NULL,
          volume NUMERIC NOT NULL,
          quote_volume NUMERIC NOT NULL,
          sum_quote NUMERIC NOT NULL,
          sum_quantity NUMERIC NOT NULL,
          item_count NUMERIC NOT NULL,
          trade_count INTEGER NOT NULL,
          first_sale_id TEXT NOT NULL,
          last_sale_id TEXT NOT NULL,
          confirmed BOOLEAN NOT NULL,
          revision INTEGER NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (instrument_key, timeframe, start_time)
        );

        CREATE TABLE IF NOT EXISTS market_snapshots (
          id SERIAL PRIMARY KEY,
          version INTEGER NOT NULL,
          timestamp BIGINT NOT NULL,
          snapshot JSONB NOT NULL,
          is_simulation BOOLEAN NOT NULL DEFAULT false
        );

        CREATE TABLE IF NOT EXISTS outbox_events (
          id SERIAL PRIMARY KEY,
          event_id TEXT UNIQUE NOT NULL,
          event_type TEXT NOT NULL,
          aggregate_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL,
          instrument_key TEXT NOT NULL,
          timeframe TEXT,
          payload JSONB NOT NULL,
          sequence BIGINT,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          available_at BIGINT NOT NULL,
          locked_at BIGINT,
          published_at BIGINT,
          last_error TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON outbox_events (status, available_at) WHERE status IN ('pending', 'processing');

        CREATE TABLE IF NOT EXISTS te_scheduler_leases (
          job_type VARCHAR(50) NOT NULL,
          job_key VARCHAR(100) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'running',
          locked_by VARCHAR(100),
          created_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL,
          completed_at BIGINT,
          PRIMARY KEY (job_type, job_key)
        );
      `);
    },
  },
  {
    id: '008_schema_consistency_alters',
    name: 'Idempotent Schema Consistency Columns and Constraints',
    up: async (client: PoolClient) => {
      const alters = [
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS executed_qty NUMERIC NOT NULL DEFAULT 0',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS remaining_qty NUMERIC NOT NULL DEFAULT 0',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS avg_fill_price NUMERIC NOT NULL DEFAULT 0',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS fee NUMERIC NOT NULL DEFAULT 0',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS position_effect VARCHAR(32)',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS reduce_only BOOLEAN NOT NULL DEFAULT false',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
        'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',

        'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
        'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
        'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',

        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',
        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS opened_at BIGINT DEFAULT 0',
        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS created_at BIGINT DEFAULT 0',
        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS updated_at BIGINT DEFAULT 0',
        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_timestamp BIGINT',
        'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_reason TEXT',

        'ALTER TABLE te_outbox_events ADD COLUMN IF NOT EXISTS currency VARCHAR(32)',
        "ALTER TABLE te_financial_audits ADD COLUMN IF NOT EXISTS currency VARCHAR(32) DEFAULT 'TON'",

        'ALTER TABLE te_ton_deposits ADD COLUMN IF NOT EXISTS sender_address VARCHAR(255)',
        'ALTER TABLE te_ton_deposits ADD COLUMN IF NOT EXISTS lt BIGINT',
        "ALTER TABLE te_ton_deposits ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'credited'",
        'ALTER TABLE te_ton_deposits ADD COLUMN IF NOT EXISTS reason TEXT',

        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0',
        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS operation_id VARCHAR(255)',
        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS next_attempt_at BIGINT',
        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS locked_at BIGINT',
        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS processed_at BIGINT',
        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS worker_id VARCHAR(255)',
        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS funds_released_at BIGINT',
        'ALTER TABLE te_withdrawals ADD COLUMN IF NOT EXISTS funds_released BOOLEAN NOT NULL DEFAULT FALSE',
      ];

      for (const query of alters) {
        await client.query(query);
      }

      // Add balance non-negative check constraints idempotently
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'te_balances_avail_nonneg'
          ) THEN
            ALTER TABLE te_balances ADD CONSTRAINT te_balances_avail_nonneg CHECK (available_balance >= 0);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'te_balances_locked_nonneg'
          ) THEN
            ALTER TABLE te_balances ADD CONSTRAINT te_balances_locked_nonneg CHECK (locked_balance >= 0);
          END IF;
        END $$;
      `);
    },
  },
];

/**
 * Executes all pending database schema migrations with PostgreSQL advisory locking.
 * Throws a fatal SchemaMigrationError on connection or DDL failure.
 */
export async function initDbSchema(
  pool: Pool,
  options?: { force?: boolean }
): Promise<SchemaInitResult> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err: any) {
    throw new SchemaMigrationError(
      `[DB Setup] Could not connect to PostgreSQL pool for schema initialization: ${err?.message || err}`,
      undefined,
      err
    );
  }

  try {
    // Check if the current user has DDL privileges on the active schema
    let canCreate = false;
    try {
      const permRes = await client.query(`
        SELECT has_schema_privilege(current_user, 'public', 'CREATE') as can_create
      `);
      canCreate = !!permRes?.rows?.[0]?.can_create;
    } catch {
      canCreate = true;
    }

    if (!canCreate) {
      // User is a runtime DML user without DDL permissions.
      // Verify if the tables already exist in the database.
      const tablesRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      const existing = new Set<string>((tablesRes?.rows || []).map((r: any) => r.table_name.toLowerCase()));
      const coreTables = [
        'te_users',
        'te_balances',
        'te_orders',
        'te_positions',
        'candles',
        'completed_sales',
      ];
      const hasCoreTables = coreTables.every((t) => existing.has(t));

      if (hasCoreTables) {
        console.log(
          '[DB Setup] Runtime user has DML access to existing schema. Core tables verified.'
        );
        return {
          appliedCount: 0,
          currentVersion: MIGRATIONS[MIGRATIONS.length - 1].id,
          appliedMigrations: MIGRATIONS.map((m) => m.id),
        };
      }
    }

    // Acquire PostgreSQL advisory lock to ensure only one migration runner runs at a time
    await client.query('SELECT pg_advisory_lock($1, $2)', [SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY]);

    try {
      // 1. Ensure migrations tracking table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS te_schema_migrations (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at BIGINT NOT NULL,
          checksum VARCHAR(64)
        );
      `);

      // 2. Fetch applied migrations
      const res = await client.query('SELECT id FROM te_schema_migrations ORDER BY id ASC');
      const appliedSet = new Set<string>((res?.rows || []).map((r: any) => r.id));

      const newlyApplied: string[] = [];

      // 3. Sequentially apply pending migrations in order
      for (const migration of MIGRATIONS) {
        if (appliedSet.has(migration.id) && !options?.force) {
          continue;
        }

        try {
          await client.query('BEGIN');
          await migration.up(client);
          await client.query(
            `INSERT INTO te_schema_migrations (id, name, applied_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET applied_at = EXCLUDED.applied_at`,
            [migration.id, migration.name, Date.now()]
          );
          await client.query('COMMIT');
          newlyApplied.push(migration.id);
          appliedSet.add(migration.id);
        } catch (migrationErr: any) {
          await client.query('ROLLBACK').catch(() => {});
          throw new SchemaMigrationError(
            `[DB Setup] Schema migration "${migration.id}" failed: ${migrationErr?.message || migrationErr}`,
            migration.id,
            migrationErr
          );
        }
      }

      const currentVersion = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].id : null;
      return {
        appliedCount: newlyApplied.length,
        currentVersion,
        appliedMigrations: Array.from(appliedSet),
      };
    } finally {
      // Always release the advisory lock
      await client
        .query('SELECT pg_advisory_unlock($1, $2)', [SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY])
        .catch(() => {});
    }
  } finally {
    client.release();
  }
}

/**
 * Returns list of applied migration IDs from te_schema_migrations.
 */
export async function getAppliedMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id FROM te_schema_migrations ORDER BY applied_at ASC, id ASC`
    );
    return res.rows.map((r: any) => r.id);
  } catch (err: any) {
    if (err?.code === '42P01') {
      // te_schema_migrations does not exist yet
      return [];
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifies that all required tables and migrations exist in the database.
 */
export async function verifySchemaIntegrity(
  pool: Pool
): Promise<{ valid: boolean; missingTables: string[]; pendingMigrations: string[] }> {
  const REQUIRED_TABLES = [
    'te_schema_migrations',
    'te_users',
    'te_balances',
    'te_orders',
    'te_trades',
    'te_executions',
    'te_positions',
    'te_outbox_events',
    'te_ton_deposits',
    'te_ton_scanner_cursor',
    'te_withdrawals',
    'te_financial_audits',
    'te_funding_payments',
    'te_funding_periods',
    'te_position_snapshots',
    'te_invoices',
    'te_payments',
    'gift_collections',
    'gift_variants',
    'completed_sales',
    'candles',
    'market_snapshots',
    'outbox_events',
    'te_scheduler_leases',
  ];

  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = current_schema() OR table_schema = 'public'
    `);
    const existing = new Set<string>(res.rows.map((r: any) => r.table_name.toLowerCase()));
    const missingTables = REQUIRED_TABLES.filter((t) => !existing.has(t.toLowerCase()));

    let applied: string[] = [];
    try {
      const migRes = await client.query('SELECT id FROM te_schema_migrations');
      applied = migRes.rows.map((r: any) => r.id);
    } catch {
      applied = [];
    }

    const appliedSet = new Set(applied);
    const pendingMigrations = MIGRATIONS.filter((m) => !appliedSet.has(m.id)).map((m) => m.id);

    return {
      valid: missingTables.length === 0 && pendingMigrations.length === 0,
      missingTables,
      pendingMigrations,
    };
  } finally {
    client.release();
  }
}
