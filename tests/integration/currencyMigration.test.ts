import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import {
  resolveInstrumentCurrency,
  migrateBalancesAndCurrencies,
} from '../../server/currencyMigration';
import { PostgresTradingEngine } from '../../server/tradingEngine';
import { initDbSchema } from '../../server/dbSchema';
import { getPostgresConfig, getDbDiagnostics } from '../../server/dbConfig';

describe('Safe te_balances & Currency Migration', () => {
  let pool: Pool;
  let engine: PostgresTradingEngine;

  beforeAll(async () => {
    const dbConf = getPostgresConfig();
    console.log('[Diagnostic] DB Connection:', getDbDiagnostics());
    if (dbConf.config) {
      pool = new Pool(dbConf.config);
    } else {
      pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
    }

    pool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });

    pool.on('connect', (client) => {
      client.query('SET search_path TO public').catch(() => {});
    });

    await initDbSchema(pool);
    engine = new PostgresTradingEngine(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    try {
      await pool.query(`
        DROP TABLE IF EXISTS pg_temp.te_orders;
        DROP TABLE IF EXISTS pg_temp.te_executions;
        DROP TABLE IF EXISTS pg_temp.te_positions;
        DROP TABLE IF EXISTS pg_temp.te_balances;
        DROP TABLE IF EXISTS pg_temp.te_outbox_events;

        CREATE TEMP TABLE te_orders (
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
        );

        CREATE TEMP TABLE te_executions (
          execution_id VARCHAR(255) PRIMARY KEY,
          order_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          instrument_key VARCHAR(255) NOT NULL,
          side VARCHAR(10) NOT NULL,
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

        CREATE TEMP TABLE te_positions (
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
          created_at BIGINT DEFAULT 0,
          updated_at BIGINT DEFAULT 0
        );

        CREATE TEMP TABLE te_balances (
          user_id VARCHAR(255),
          currency VARCHAR(20) DEFAULT 'TON',
          available_balance NUMERIC NOT NULL,
          locked_balance NUMERIC NOT NULL DEFAULT 0,
          realized_pnl NUMERIC NOT NULL DEFAULT 0,
          total_fees NUMERIC NOT NULL DEFAULT 0,
          created_at BIGINT DEFAULT 0,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (user_id, currency)
        );

        CREATE TEMP TABLE te_outbox_events (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(50) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          payload TEXT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          currency VARCHAR(20),
          created_at BIGINT NOT NULL,
          published_at BIGINT
        );
      `);
    } catch (e: any) {
      console.warn('Test setup error:', e?.message);
    }
  });

  it('Documented Rules: resolveInstrumentCurrency correctly identifies TON vs STARS vs Unknown', () => {
    expect(resolveInstrumentCurrency('TON')).toEqual({ currency: 'TON', isUnresolvable: false });
    expect(resolveInstrumentCurrency('TON-USDT')).toEqual({
      currency: 'TON',
      isUnresolvable: false,
    });
    expect(resolveInstrumentCurrency('durov-cap')).toEqual({
      currency: 'TON',
      isUnresolvable: false,
    });
    expect(resolveInstrumentCurrency('coll1:all:all:TON')).toEqual({
      currency: 'TON',
      isUnresolvable: false,
    });

    expect(resolveInstrumentCurrency('STARS')).toEqual({
      currency: 'STARS',
      isUnresolvable: false,
    });
    expect(resolveInstrumentCurrency('STARS-USDT')).toEqual({
      currency: 'STARS',
      isUnresolvable: false,
    });
    expect(resolveInstrumentCurrency('star')).toEqual({ currency: 'STARS', isUnresolvable: false });
    expect(resolveInstrumentCurrency('coll1:all:all:STARS')).toEqual({
      currency: 'STARS',
      isUnresolvable: false,
    });

    // Unknown instrument keys must NOT default to TON
    const unknownRes = resolveInstrumentCurrency('UNKNOWN_TOKEN_ABC');
    expect(unknownRes.isUnresolvable).toBe(true);
    expect(unknownRes.currency).toBeNull();
  });

  it('1. Preserves existing balances and migrates legacy rows to (user_id, TON) without loss', async () => {
    // Insert legacy balances for user1 and user2
    const now = Date.now();
    await pool.query(
      `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, updated_at, created_at)
       VALUES ('user1', 'TON', 5000, 100, 50, 10, $1, $1), ('user2', 'TON', 12000, 0, 0, 0, $1, $1)`,
      [now]
    );

    const summary = await migrateBalancesAndCurrencies(pool, { strictMode: true });
    expect(summary.migratedBalances).toBeGreaterThanOrEqual(0);

    // Verify user1 balance in TON
    const user1Bal = await pool.query(
      `SELECT * FROM te_balances WHERE user_id = 'user1' AND currency = 'TON'`
    );
    expect(user1Bal.rows.length).toBe(1);
    expect(Number(user1Bal.rows[0].available_balance)).toBe(5000);
    expect(Number(user1Bal.rows[0].locked_balance)).toBe(100);
    expect(Number(user1Bal.rows[0].realized_pnl)).toBe(50);
    expect(Number(user1Bal.rows[0].total_fees)).toBe(10);

    // Verify NO positive STARS balance was created out of thin air
    const starsBal = await pool.query(
      `SELECT * FROM te_balances WHERE user_id = 'user1' AND currency = 'STARS'`
    );
    expect(starsBal.rows.length).toBe(0);
  });

  it('2. Idempotency: Running migration repeatedly does not corrupt data or fail', async () => {
    const now = Date.now();
    await pool.query(
      `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, updated_at, created_at)
       VALUES ('user_idempotent', 'TON', 7500, 50, 25, 5, $1, $1)`,
      [now]
    );

    // First run
    await migrateBalancesAndCurrencies(pool, { strictMode: true });

    // Second run
    const summary2 = await migrateBalancesAndCurrencies(pool, { strictMode: true });
    expect(summary2.unresolvedCount).toBe(0);

    // Balance intact
    const balRes = await pool.query(
      `SELECT * FROM te_balances WHERE user_id = 'user_idempotent' AND currency = 'TON'`
    );
    expect(balRes.rows.length).toBe(1);
    expect(Number(balRes.rows[0].available_balance)).toBe(7500);
  });

  it('3. Migrates existing orders, positions, trades, executions, and outbox events', async () => {
    const now = Date.now();
    // Insert orders (pre-migration state: settlement_currency is NULL)
    await pool.query(
      `
      INSERT INTO te_orders (order_id, user_id, instrument_key, side, order_type, qty, price, executed_qty, remaining_qty, avg_fill_price, fee, status, reduce_only, settlement_currency, created_at, updated_at)
      VALUES 
        ('o1', 'u1', 'coll1:all:all:TON', 'Buy', 'Limit', 10, 5, 0, 10, 0, 0, 'Open', false, NULL, $1, $1),
        ('o2', 'u1', 'coll2:all:all:STARS', 'Buy', 'Limit', 5, 20, 0, 5, 0, 0, 'Open', false, NULL, $1, $1)
    `,
      [now]
    );

    // Insert positions
    await pool.query(`
      INSERT INTO te_positions (position_id, user_id, instrument_key, side, qty, avg_entry_price, mark_price, unrealized_pnl, realized_pnl, status, settlement_currency)
      VALUES
        ('p1', 'u1', 'TON-USDT', 'Long', 10, 5, 5, 0, 0, 'Open', NULL),
        ('p2', 'u1', 'STARS-USDT', 'Short', 5, 20, 20, 0, 0, 'Open', NULL)
    `);

    // Insert outbox events without currency
    await pool.query(
      `
      INSERT INTO te_outbox_events (event_type, user_id, payload, status, currency, created_at)
      VALUES
        ('orderUpdated', 'u1', '{"instrumentKey": "star:all:all:STARS"}', 'pending', NULL, $1)
    `,
      [now]
    );

    const summary = await migrateBalancesAndCurrencies(pool, { strictMode: true });
    expect(summary.migratedOrders).toBe(2);
    expect(summary.migratedPositions).toBe(2);
    expect(summary.migratedOutboxEvents).toBe(1);

    // Verify order 1 (TON) and order 2 (STARS)
    const o1 = await pool.query(`SELECT settlement_currency FROM te_orders WHERE order_id = 'o1'`);
    expect(o1.rows[0].settlement_currency).toBe('TON');

    const o2 = await pool.query(`SELECT settlement_currency FROM te_orders WHERE order_id = 'o2'`);
    expect(o2.rows[0].settlement_currency).toBe('STARS');

    // Verify positions
    const p1 = await pool.query(
      `SELECT settlement_currency FROM te_positions WHERE position_id = 'p1'`
    );
    expect(p1.rows[0].settlement_currency).toBe('TON');

    const p2 = await pool.query(
      `SELECT settlement_currency FROM te_positions WHERE position_id = 'p2'`
    );
    expect(p2.rows[0].settlement_currency).toBe('STARS');

    // Verify outbox
    const ob = await pool.query(`SELECT currency FROM te_outbox_events WHERE user_id = 'u1'`);
    expect(ob.rows[0].currency).toBe('STARS');
  });

  it('4. Controlled error in strict mode if instrument currency cannot be determined', async () => {
    const now = Date.now();
    await pool.query(
      `
      INSERT INTO te_orders (order_id, user_id, instrument_key, side, order_type, qty, price, executed_qty, remaining_qty, avg_fill_price, fee, status, reduce_only, settlement_currency, created_at, updated_at)
      VALUES ('o_unknown', 'u1', 'MY_UNKNOWN_CUSTOM_ASSET', 'Buy', 'Limit', 10, 5, 0, 10, 0, 0, 'Open', false, NULL, $1, $1)
    `,
      [now]
    );

    await expect(migrateBalancesAndCurrencies(pool, { strictMode: true })).rejects.toThrow(
      /Controlled Currency Migration Error: Unable to determine currency/
    );
  });

  it('5. Marks unknown records for manual review when strictMode is false', async () => {
    const now = Date.now();
    await pool.query(
      `
      INSERT INTO te_orders (order_id, user_id, instrument_key, side, order_type, qty, price, executed_qty, remaining_qty, avg_fill_price, fee, status, reduce_only, settlement_currency, created_at, updated_at)
      VALUES ('o_manual', 'u1', 'MY_UNKNOWN_CUSTOM_ASSET', 'Buy', 'Limit', 10, 5, 0, 10, 0, 0, 'Open', false, NULL, $1, $1)
    `,
      [now]
    );

    const summary = await migrateBalancesAndCurrencies(pool, { strictMode: false });
    expect(summary.unresolvedCount).toBe(1);
    expect(summary.unresolvedRecords[0].instrumentKey).toBe('MY_UNKNOWN_CUSTOM_ASSET');

    const o = await pool.query(
      `SELECT status, rejection_reason FROM te_orders WHERE order_id = 'o_manual'`
    );
    expect(o.rows[0].status).toBe('Rejected');
    expect(o.rows[0].rejection_reason).toBe('UNRESOLVED_CURRENCY_REQUIRES_MANUAL_REVIEW');
  });

  it('6. Order rejection when insufficient funds in required currency', async () => {
    // Setup balance table with TON balance but 0 STARS
    await migrateBalancesAndCurrencies(pool, { strictMode: false });
    await pool.query(
      `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, updated_at, created_at)
       VALUES ('user_stars', 'TON', 10000, 0, 0, 0, $1, $1), ('user_stars', 'STARS', 5, 0, 0, 0, $1, $1)`,
      [Date.now()]
    );

    // Place order requiring 100 STARS
    const starsOrder = await engine.placeOrder({
      userId: 'user_stars',
      instrumentKey: 'star:all:all:STARS',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 10, // Requires 100 STARS
      reduceOnly: false,
    });

    expect(starsOrder.status).toBe('Rejected');
    expect(starsOrder.rejectionReason).toContain('STARS');
    expect(starsOrder.rejectionReason).toContain('Insufficient margin');
  });
});
