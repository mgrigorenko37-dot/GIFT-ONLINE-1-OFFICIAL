import { Pool, Client } from 'pg';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import { initDbSchema } from '../../server/dbSchema';
import { getPostgresConfig } from '../../server/dbConfig';

let globalIntegrationPool: Pool | null = null;

const dbConf = getPostgresConfig();
let dbUrlFromConf = '';
if (dbConf.config) {
  if (dbConf.source === 'DATABASE_URL') {
    dbUrlFromConf = process.env.DATABASE_URL || '';
  } else if (dbConf.config.host) {
    dbUrlFromConf = `postgres://${dbConf.config.user}:${dbConf.config.password}@${dbConf.config.host}:${dbConf.config.port}/${dbConf.config.database}`;
  }
}

export const DEFAULT_TEST_DATABASE_URL =
  dbUrlFromConf || 'postgres://node@localhost:5432/gx_exchange_test';

/**
 * Initializes and returns the PostgreSQL Pool for integration tests.
 * Throws an explicit error if the database is unreachable to ensure tests FAIL fast instead of silently skipping.
 */
export async function getTestDbPool(): Promise<Pool> {
  if (globalIntegrationPool) {
    return globalIntegrationPool;
  }

  const poolConf = dbConf.config || {
    connectionString: DEFAULT_TEST_DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  };
  if (!poolConf.max) poolConf.max = 20;

  const pool = new Pool(poolConf);

  // Test database connection immediately
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
  } catch (err: any) {
    await pool.end().catch(() => {});
    throw new Error(
      `[PostgreSQL Integration Fixture Failure] Unable to connect to PostgreSQL at "${DEFAULT_TEST_DATABASE_URL}": ${err?.message || err}. Integration tests require a running PostgreSQL instance.`
    );
  } finally {
    if (client) client.release();
  }

  // Initialize DB Schema (tables, indexes, check constraints)
  await initDbSchema(pool);

  globalIntegrationPool = pool;
  return globalIntegrationPool;
}

/**
 * Creates an independent, dedicated PostgreSQL client connection for testing concurrency (e.g., FOR UPDATE locking).
 */
export async function createSeparateClient(): Promise<Client> {
  const clientConf = dbConf.config ? { ...dbConf.config } : { connectionString: DEFAULT_TEST_DATABASE_URL };
  const client = new Client(clientConf);
  await client.connect();
  return client;
}

/**
 * Generates a unique numeric user ID string for test isolation.
 * Ensures compatibility with Telegram user.id numeric requirement.
 */
export function createUniqueNumericUserId(): string {
  let ts = Date.now().toString().slice(-8);
  if (ts.startsWith('0')) {
    ts = '1' + ts.slice(1);
  }
  const rand = Math.floor(100000 + Math.random() * 900000).toString();
  return `${ts}${rand}`;
}

/**
 * Generates a unique string ID for test isolation.
 */
export function createUniqueUserId(prefix: string = 'user'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Seeds a user with wallet address and balances directly in PostgreSQL.
 */
export async function seedTestUser(
  pool: Pool,
  userId: string,
  walletAddress: string,
  balances: { TON?: string | number; STARS?: string | number } = { TON: '100.0' }
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO te_users (id, wallet_address)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET wallet_address = $2`,
      [userId, walletAddress]
    );

    const now = Date.now();
    if (balances.TON !== undefined) {
      await client.query(
        `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, updated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (user_id, currency) DO UPDATE
         SET available_balance = $3, locked_balance = $4, updated_at = $5`,
        [userId, 'TON', String(balances.TON), '0', now]
      );
    }

    if (balances.STARS !== undefined) {
      await client.query(
        `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, updated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (user_id, currency) DO UPDATE
         SET available_balance = $3, locked_balance = $4, updated_at = $5`,
        [userId, 'STARS', String(balances.STARS), '0', now]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cleans up isolated user test data from all relevant PostgreSQL tables after each test.
 */
export async function cleanupUserData(pool: Pool, userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM te_payments WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM te_invoices WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM te_withdrawals WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM te_outbox_events WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM te_financial_audits WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM te_balances WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM te_users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }
}

/**
 * Direct PostgreSQL state query helpers for table assertions.
 */
export async function queryBalance(pool: Pool, userId: string, currency: string = 'TON') {
  const res = await pool.query(
    'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2',
    [userId, currency]
  );
  if (res.rows.length === 0) return null;
  return {
    available_balance: new Decimal(res.rows[0].available_balance),
    locked_balance: new Decimal(res.rows[0].locked_balance),
  };
}

export async function queryWithdrawal(pool: Pool, withdrawalId: string) {
  const res = await pool.query('SELECT * FROM te_withdrawals WHERE id = $1', [withdrawalId]);
  return res.rows[0] || null;
}

export async function queryOutboxEvents(pool: Pool, userId: string) {
  const res = await pool.query(
    'SELECT * FROM te_outbox_events WHERE user_id = $1 ORDER BY id ASC',
    [userId]
  );
  return res.rows;
}

export async function queryFinancialAudits(pool: Pool, userId: string) {
  const res = await pool.query(
    'SELECT * FROM te_financial_audits WHERE user_id = $1 ORDER BY id ASC',
    [userId]
  );
  return res.rows;
}

export async function queryInvoices(pool: Pool, userId: string) {
  const res = await pool.query(
    'SELECT * FROM te_invoices WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return res.rows;
}

export async function queryInvoiceById(pool: Pool, invoiceId: string) {
  const res = await pool.query('SELECT * FROM te_invoices WHERE id = $1', [invoiceId]);
  return res.rows[0] || null;
}

export async function queryPayments(pool: Pool, userId: string) {
  const res = await pool.query(
    'SELECT * FROM te_payments WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return res.rows;
}

export async function queryPaymentByChargeId(pool: Pool, chargeId: string) {
  const res = await pool.query('SELECT * FROM te_payments WHERE telegram_payment_charge_id = $1', [
    chargeId,
  ]);
  return res.rows[0] || null;
}

export async function closeTestDbPool(): Promise<void> {
  if (globalIntegrationPool) {
    await globalIntegrationPool.end().catch(() => {});
    globalIntegrationPool = null;
  }
}
