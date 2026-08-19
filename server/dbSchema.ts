import { Pool } from 'pg';

export async function initDbSchema(pool: Pool) {
  let client;
  try {
    client = await pool.connect();
  } catch (err: any) {
    console.warn('[DB Setup] Could not connect to pool for DDL:', err?.message);
    return;
  }

  try {
    try {
      await client.query('SET search_path TO public');
    } catch (err) {}

    const tables = [
      `CREATE TABLE IF NOT EXISTS te_orders (
        order_id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
        order_type VARCHAR(20) NOT NULL,
        qty NUMERIC NOT NULL,
        price NUMERIC NOT NULL,
        reduce_only BOOLEAN NOT NULL DEFAULT false,
        position_effect VARCHAR(20),
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
      )`,
      `CREATE TABLE IF NOT EXISTS te_trades (
        trade_id VARCHAR(255) PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
        qty NUMERIC NOT NULL,
        price NUMERIC NOT NULL,
        fee NUMERIC NOT NULL,
        settlement_currency VARCHAR(32),
        fee_currency VARCHAR(32),
        pnl_currency VARCHAR(32),
        realized_pnl NUMERIC NOT NULL DEFAULT 0,
        timestamp BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS te_executions (
        execution_id VARCHAR(255) PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
        qty NUMERIC NOT NULL,
        price NUMERIC NOT NULL,
        fee NUMERIC NOT NULL,
        status VARCHAR(20) NOT NULL,
        settlement_currency VARCHAR(32),
        fee_currency VARCHAR(32),
        pnl_currency VARCHAR(32),
        created_at BIGINT NOT NULL,
        processed_at BIGINT NOT NULL,
        source VARCHAR(50),
        external_execution_id VARCHAR(255)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS te_executions_source_ext_idx ON te_executions(source, external_execution_id) WHERE source IS NOT NULL AND external_execution_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS te_positions (
        position_id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        side VARCHAR(10) NOT NULL,
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
        updated_at BIGINT DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS te_balances (
        user_id VARCHAR(255),
        currency VARCHAR(20) DEFAULT 'TON',
        available_balance NUMERIC NOT NULL,
        locked_balance NUMERIC NOT NULL DEFAULT 0,
        realized_pnl NUMERIC NOT NULL DEFAULT 0,
        total_fees NUMERIC NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, currency)
      )`,
      `CREATE TABLE IF NOT EXISTS te_outbox_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        payload TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        currency VARCHAR(20),
        created_at BIGINT NOT NULL,
        published_at BIGINT
      )`,
      `CREATE TABLE IF NOT EXISTS te_ton_deposits (
        hash VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        sender_address VARCHAR(255),
        amount NUMERIC NOT NULL,
        lt BIGINT,
        created_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS te_ton_scanner_cursor (
        id VARCHAR(50) PRIMARY KEY,
        last_lt BIGINT NOT NULL DEFAULT 0,
        last_hash VARCHAR(255),
        updated_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS te_users (
        id VARCHAR(255) PRIMARY KEY,
        wallet_address VARCHAR(255)
      )`,
      `CREATE TABLE IF NOT EXISTS te_withdrawals (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        amount NUMERIC NOT NULL,
        currency VARCHAR(32) NOT NULL DEFAULT 'TON',
        address VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        tx_hash VARCHAR(255),
        failure_reason TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS te_funding_payments (
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
      )`,
      `CREATE TABLE IF NOT EXISTS te_funding_periods (
        instrument_key VARCHAR(255) NOT NULL,
        currency VARCHAR(32) NOT NULL,
        funding_interval VARCHAR(32) NOT NULL DEFAULT '8h',
        funding_timestamp BIGINT NOT NULL,
        funding_rate NUMERIC NOT NULL,
        mark_price NUMERIC NOT NULL,
        created_at BIGINT NOT NULL,
        CONSTRAINT te_funding_periods_pk PRIMARY KEY (instrument_key, currency, funding_interval, funding_timestamp)
      )`,
      `CREATE TABLE IF NOT EXISTS te_position_snapshots (
        snapshot_id VARCHAR(255) PRIMARY KEY,
        position_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        instrument_key VARCHAR(255) NOT NULL,
        currency VARCHAR(32) NOT NULL,
        side VARCHAR(32) NOT NULL,
        qty NUMERIC NOT NULL,
        avg_entry_price NUMERIC NOT NULL,
        valid_from BIGINT NOT NULL,
        valid_to BIGINT,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS te_pos_snap_pos_time_idx ON te_position_snapshots(position_id, valid_from, valid_to)`,
      `CREATE TABLE IF NOT EXISTS gift_collections (
        id VARCHAR(255) PRIMARY KEY,
        name TEXT NOT NULL,
        total_supply NUMERIC,
        image_url TEXT,
        floor_price_gx NUMERIC,
        created_at TIMESTAMPTZ DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS gift_variants (
        id VARCHAR(255) PRIMARY KEY,
        collection_id VARCHAR(255) REFERENCES gift_collections(id) ON DELETE CASCADE,
        model_name TEXT,
        backdrop_color TEXT,
        symbol_name TEXT,
        rarity_percentage NUMERIC,
        current_price_gx NUMERIC,
        image_url TEXT,
        last_synced_at TIMESTAMPTZ DEFAULT now()
      )`
    ];

    for (const sql of tables) {
      try {
        await client.query(sql);
      } catch (e: any) {
        console.warn('[DB Setup] Notice on CREATE TABLE:', e?.message);
      }
    }

    const alterQueries = [
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS executed_qty NUMERIC NOT NULL DEFAULT 0',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS remaining_qty NUMERIC NOT NULL DEFAULT 0',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS avg_fill_price NUMERIC NOT NULL DEFAULT 0',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS fee NUMERIC NOT NULL DEFAULT 0',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS position_effect VARCHAR(20)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS reduce_only BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE te_orders ALTER COLUMN position_effect TYPE VARCHAR(32)',
      'ALTER TABLE te_balances ALTER COLUMN currency TYPE VARCHAR(32)',
      'ALTER TABLE te_orders ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_positions ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_trades ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_executions ALTER COLUMN side TYPE VARCHAR(32)',
      'ALTER TABLE te_outbox_events ALTER COLUMN event_type TYPE VARCHAR(100)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_orders ALTER COLUMN settlement_currency DROP NOT NULL',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
      'ALTER TABLE te_orders ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',

      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_executions ALTER COLUMN settlement_currency DROP NOT NULL',
      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(32)',
      'ALTER TABLE te_executions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',

      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS settlement_currency VARCHAR(32)',
      'ALTER TABLE te_positions ALTER COLUMN settlement_currency DROP NOT NULL',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS pnl_currency VARCHAR(32)',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS collateral_currency VARCHAR(32)',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS opened_at BIGINT DEFAULT 0',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS created_at BIGINT DEFAULT 0',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS updated_at BIGINT DEFAULT 0',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_timestamp BIGINT',
      'ALTER TABLE te_positions ADD COLUMN IF NOT EXISTS liquidation_reason TEXT',

      'ALTER TABLE te_outbox_events ADD COLUMN IF NOT EXISTS currency VARCHAR(32)',
      'ALTER TABLE te_ton_deposits ADD COLUMN IF NOT EXISTS sender_address VARCHAR(255)',
      'ALTER TABLE te_ton_deposits ADD COLUMN IF NOT EXISTS lt BIGINT',

      'GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC',
      'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC',
    ];

    for (const query of alterQueries) {
      try {
        await client.query(query);
      } catch (e: any) {
        console.warn('[DB Setup] Notice on ALTER query:', e?.message);
      }
    }
  } catch (err: any) {
    console.warn('[DB Setup] Error during schema init:', err?.message);
  } finally {
    client.release();
  }
}
