import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveMarketRepository,
  PostgresMarketRepository,
  FilePersistentMarketRepository,
  InMemoryMarketRepository,
} from './marketRepository';

describe('Production Safety Rules: PostgreSQL & File Storage Isolation', () => {
  let origNodeEnv: string | undefined;
  let origDbUrl: string | undefined;
  let origStorageMode: string | undefined;
  let origAllowFileInProd: string | undefined;

  beforeEach(() => {
    origNodeEnv = process.env.NODE_ENV;
    origDbUrl = process.env.DATABASE_URL;
    origStorageMode = process.env.STORAGE_MODE;
    origAllowFileInProd = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;
  });

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origDbUrl !== undefined) {
      process.env.DATABASE_URL = origDbUrl;
    } else {
      delete process.env.DATABASE_URL;
      delete process.env.SQL_HOST;
    }
    if (origStorageMode !== undefined) {
      process.env.STORAGE_MODE = origStorageMode;
    } else {
      delete process.env.STORAGE_MODE;
    }
    if (origAllowFileInProd !== undefined) {
      process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = origAllowFileInProd;
    } else {
      delete process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;
    }
  });

  it('1. production без DATABASE_URL: blocks startup and throws critical configuration error', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.SQL_HOST;
    delete process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;

    expect(() => resolveMarketRepository()).toThrow(/CRITICAL CONFIGURATION ERROR/i);
  });

  it('2. production с DATABASE_URL: resolves to PostgresMarketRepository', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';

    const repo = resolveMarketRepository();
    expect(repo).toBeInstanceOf(PostgresMarketRepository);
  });

  it('3. production с ALLOW_FILE_STORAGE_IN_PRODUCTION=true: ignores true flag, blocks file storage and throws error when DATABASE_URL missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.SQL_HOST;
    process.env.STORAGE_MODE = 'file';
    process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = 'true';

    expect(() => resolveMarketRepository()).toThrow(/CRITICAL CONFIGURATION ERROR/i);
  });

  it('4. development с file storage: returns FilePersistentMarketRepository', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_URL;
    delete process.env.SQL_HOST;
    process.env.STORAGE_MODE = 'file';

    const repo = resolveMarketRepository();
    expect(repo).toBeInstanceOf(FilePersistentMarketRepository);
  });

  it('5. test с file storage: returns FilePersistentMarketRepository', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DATABASE_URL;
    delete process.env.SQL_HOST;
    process.env.STORAGE_MODE = 'file';

    const repo = resolveMarketRepository();
    expect(repo).toBeInstanceOf(FilePersistentMarketRepository);
  });

  it('6. проверка, что production repository всегда PostgreSQL: never returns FilePersistentMarketRepository in production even with overrides', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';
    process.env.STORAGE_MODE = 'file';
    process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = 'true';

    const repo = resolveMarketRepository();
    expect(repo).toBeInstanceOf(PostgresMarketRepository);
    expect(repo).not.toBeInstanceOf(FilePersistentMarketRepository);
  });

  it('7. миграции не запускаются обычным runtime-пользователем: initSchema ignores DDL in production unless RUN_MIGRATIONS=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';

    // We mock the pool connect to verify if it's called
    const repo = new PostgresMarketRepository();
    let connectCalled = false;
    (repo as any).pool.connect = async () => {
      connectCalled = true;
      return { query: async () => {}, release: () => {} };
    };

    await repo.initSchema();
    expect(connectCalled).toBe(false);

    // With flag, it should be called
    process.env.RUN_MIGRATIONS = 'true';
    const repo2 = new PostgresMarketRepository();
    (repo2 as any).pool.connect = async () => {
      connectCalled = true;
      return { query: async () => {}, release: () => {} };
    };
    await repo2.initSchema();
    expect(connectCalled).toBe(true);
  });
});
