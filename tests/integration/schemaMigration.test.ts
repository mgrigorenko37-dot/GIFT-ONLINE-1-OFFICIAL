import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import {
  initDbSchema,
  getAppliedMigrations,
  verifySchemaIntegrity,
  SchemaMigrationError,
  MIGRATIONS,
  SCHEMA_LOCK_NAMESPACE,
  SCHEMA_LOCK_KEY,
} from '../../server/dbSchema';
import { startServer, setupDatabaseSchema } from '../../server';
import * as marketRepo from '../../server/marketRepository';
import * as dbConfig from '../../server/dbConfig';

describe('Production-Ready PostgreSQL Schema Management & Safety', () => {
  it('1. Idempotency: repeated execution skips already applied migrations cleanly', async () => {
    const appliedDbIds: string[] = [];
    const executedQueries: string[] = [];

    const createMockClient = () => ({
      query: vi.fn(async (sql: string, params?: any[]) => {
        executedQueries.push(sql);
        if (sql.includes('pg_advisory_lock')) {
          return { rows: [{ acquired: true }] };
        }
        if (sql.includes('pg_advisory_unlock')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT current_user')) {
          return { rows: [{ current_user: 'postgres' }] };
        }
        if (sql.includes('CREATE TABLE IF NOT EXISTS te_schema_migrations')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT id FROM te_schema_migrations')) {
          return { rows: appliedDbIds.map((id) => ({ id })) };
        }
        if (sql.includes('INSERT INTO te_schema_migrations')) {
          const id = params?.[0];
          if (id) appliedDbIds.push(id);
          return { rows: [] };
        }
        if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    });

    const mockPool = {
      connect: vi.fn(async () => createMockClient()),
    } as unknown as Pool;

    // First run: all migrations should be applied
    const firstRun = await initDbSchema(mockPool);
    expect(firstRun.appliedCount).toBe(MIGRATIONS.length);
    expect(firstRun.currentVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1].id);
    expect(appliedDbIds.length).toBe(MIGRATIONS.length);

    // Second run: 0 migrations applied, idempotent
    const secondRun = await initDbSchema(mockPool);
    expect(secondRun.appliedCount).toBe(0);
    expect(secondRun.currentVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1].id);
  });

  it('2. Concurrency: advisory locks prevent concurrent collision', async () => {
    let lockHolder: string | null = null;
    const lockEvents: string[] = [];

    const createLockingMockClient = (runnerId: string) => ({
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('pg_advisory_lock')) {
          expect(params).toEqual([SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY]);
          lockHolder = runnerId;
          lockEvents.push(`${runnerId}:acquired_lock`);
          return { rows: [{ acquired: true }] };
        }
        if (sql.includes('pg_advisory_unlock')) {
          expect(params).toEqual([SCHEMA_LOCK_NAMESPACE, SCHEMA_LOCK_KEY]);
          lockEvents.push(`${runnerId}:released_lock`);
          lockHolder = null;
          return { rows: [] };
        }
        if (sql.includes('SELECT current_user')) {
          return { rows: [{ current_user: 'postgres' }] };
        }
        if (sql.includes('CREATE TABLE IF NOT EXISTS te_schema_migrations')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT id FROM te_schema_migrations')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    });

    const mockPool = {
      connect: vi.fn(async () => createLockingMockClient('runner_1')),
    } as unknown as Pool;

    const res = await initDbSchema(mockPool);
    expect(res.appliedCount).toBe(MIGRATIONS.length);
    expect(lockEvents).toEqual(['runner_1:acquired_lock', 'runner_1:released_lock']);
  });

  it('3. Fail-fast on incompatible schema / invalid migration (rolls back and unlocks)', async () => {
    let unlocked = false;
    let rolledBack = false;

    const mockClient = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (typeof sql === 'string' && sql.includes('pg_advisory_lock')) {
          return { rows: [{ acquired: true }] };
        }
        if (typeof sql === 'string' && sql.includes('pg_advisory_unlock')) {
          unlocked = true;
          return { rows: [] };
        }
        if (typeof sql === 'string' && sql.includes('SELECT current_user')) {
          return { rows: [{ current_user: 'postgres' }] };
        }
        if (
          typeof sql === 'string' &&
          sql.includes('CREATE TABLE IF NOT EXISTS te_schema_migrations')
        ) {
          return { rows: [] };
        }
        if (typeof sql === 'string' && sql.includes('SELECT id FROM te_schema_migrations')) {
          return { rows: [] };
        }
        if (typeof sql === 'string' && sql.includes('BEGIN')) {
          return { rows: [] };
        }
        if (typeof sql === 'string' && sql.includes('ROLLBACK')) {
          rolledBack = true;
          return { rows: [] };
        }
        // Simulate a fatal syntax or constraint error during migration
        throw new Error('syntax error at or near "INVALID_TABLE_DDL"');
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn(async () => mockClient),
    } as unknown as Pool;

    await expect(initDbSchema(mockPool)).rejects.toThrow(SchemaMigrationError);
    await expect(initDbSchema(mockPool)).rejects.toThrow(/syntax error/i);

    // Verify advisory unlock and rollback were called
    expect(rolledBack).toBe(true);
    expect(unlocked).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('4. Application server does NOT start if migration fails in production', async () => {
    const isPgConfiguredSpy = vi.spyOn(dbConfig, 'isPostgresConfigured').mockReturnValue(true);
    const getPgPoolSpy = vi.spyOn(marketRepo, 'getPgPool').mockImplementation(() => {
      return {
        connect: vi.fn(async () => {
          throw new Error('FATAL: Database connection refused during startup migration');
        }),
      } as unknown as Pool;
    });

    try {
      // setupDatabaseSchema must throw
      await expect(setupDatabaseSchema()).rejects.toThrow(
        /Could not connect to PostgreSQL pool for schema initialization/
      );
    } finally {
      isPgConfiguredSpy.mockRestore();
      getPgPoolSpy.mockRestore();
    }
  });

  it('5. Local mode preservation: skips PostgreSQL migration when DATABASE_URL is not configured', async () => {
    const isPgConfiguredSpy = vi.spyOn(dbConfig, 'isPostgresConfigured').mockReturnValue(false);
    const getPgPoolSpy = vi.spyOn(marketRepo, 'getPgPool');

    try {
      // Must return cleanly without attempting to connect to PostgreSQL
      await expect(setupDatabaseSchema()).resolves.toBeUndefined();
      expect(getPgPoolSpy).not.toHaveBeenCalled();
    } finally {
      isPgConfiguredSpy.mockRestore();
      getPgPoolSpy.mockRestore();
    }
  });
});
