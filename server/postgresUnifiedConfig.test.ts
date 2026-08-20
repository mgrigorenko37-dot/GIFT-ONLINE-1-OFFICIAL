import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import {
  getPostgresConfig,
  isPostgresConfigured,
  getSanitizedDbTarget,
} from './dbConfig';
import systemRoutes from './routes/systemRoutes';
import { getPgPool } from './marketRepository';

describe('PostgreSQL Unified Configuration & Readiness Verification', () => {
  let origEnv: NodeJS.ProcessEnv;
  let app: express.Express;
  let server: HttpServer;
  let serverPort: number;

  beforeEach(async () => {
    origEnv = { ...process.env };
    // Clear pool global cache between tests if any
    delete (global as any)._postgresPool;

    app = express();
    app.use(express.json());
    app.use(systemRoutes);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    delete (global as any)._postgresPool;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. DATABASE_URL задан: config uses DATABASE_URL as primary source', () => {
    process.env.DATABASE_URL = 'postgresql://custom_user:secret_pass@dbhost.internal:5432/gx_prod_db';
    delete process.env.SQL_HOST;
    delete process.env.SQL_PORT;

    const result = getPostgresConfig();
    expect(result.isConfigured).toBe(true);
    expect(result.source).toBe('DATABASE_URL');
    expect(result.config).toEqual({
      connectionString: 'postgresql://custom_user:secret_pass@dbhost.internal:5432/gx_prod_db',
      max: 20,
    });
    expect(isPostgresConfigured()).toBe(true);

    const safeTarget = getSanitizedDbTarget();
    expect(safeTarget).toContain('dbhost.internal');
    expect(safeTarget).not.toContain('secret_pass');
  });

  it('2. задан legacy-набор SQL_*: config uses SQL_* parameters as local development fallback', () => {
    delete process.env.DATABASE_URL;
    process.env.SQL_HOST = '127.0.0.1';
    process.env.SQL_PORT = '5433';
    process.env.SQL_USER = 'dev_user';
    process.env.SQL_PASSWORD = 'dev_password';
    process.env.SQL_DATABASE = 'dev_gx_db';

    const result = getPostgresConfig();
    expect(result.isConfigured).toBe(true);
    expect(result.source).toBe('SQL_LEGACY');
    expect(result.config).toEqual({
      host: '127.0.0.1',
      port: 5433,
      user: 'dev_user',
      password: 'dev_password',
      database: 'dev_gx_db',
      max: 20,
    });
    expect(isPostgresConfigured()).toBe(true);

    const safeTarget = getSanitizedDbTarget();
    expect(safeTarget).toContain('127.0.0.1:5433/dev_gx_db');
    expect(safeTarget).not.toContain('dev_password');
  });

  it('3. ничего не задано: config returns isConfigured=false and getPgPool throws explicit error', () => {
    delete process.env.DATABASE_URL;
    delete process.env.SQL_HOST;
    delete process.env.SQL_PORT;
    delete process.env.SQL_USER;
    delete process.env.SQL_PASSWORD;
    delete process.env.SQL_DATABASE;
    delete process.env.SQL_DB_NAME;

    const result = getPostgresConfig();
    expect(result.isConfigured).toBe(false);
    expect(result.source).toBe('NONE');
    expect(result.config).toBeNull();
    expect(isPostgresConfigured()).toBe(false);
    expect(getSanitizedDbTarget()).toBe('none');

    expect(() => getPgPool()).toThrow(/Neither DATABASE_URL nor SQL_HOST is configured/);
  });

  it('4. production без БД → readiness возвращает 503', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.SQL_HOST;
    delete process.env.REQUIRE_REDIS;

    const res = await fetch(`http://127.0.0.1:${serverPort}/readiness`);
    expect(res.status).toBe(503);

    const data = await res.json();
    expect(data.ready).toBe(false);
    expect(data.reason).toContain('PostgreSQL (DATABASE_URL) is strictly required in production.');
  });

  it('5. production с DATABASE_URL → readiness не выдаёт ложную ошибку из-за отсутствия SQL_HOST', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:secret@127.0.0.1:5432/gx_exchange';
    delete process.env.SQL_HOST;
    delete process.env.REQUIRE_REDIS;

    const res = await fetch(`http://127.0.0.1:${serverPort}/readiness`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ready).toBe(true);

    const healthRes = await fetch(`http://127.0.0.1:${serverPort}/health`);
    expect(healthRes.status).toBe(200);
    const healthData = await healthRes.json();
    expect(healthData.database.connected).toBe(true);
  });

  it('6. DATABASE_URL takes priority over SQL_* legacy variables', () => {
    process.env.DATABASE_URL = 'postgresql://primary:pass@cloudsql.internal:5432/primary_db';
    process.env.SQL_HOST = 'secondary-host';
    process.env.SQL_USER = 'secondary-user';

    const result = getPostgresConfig();
    expect(result.isConfigured).toBe(true);
    expect(result.source).toBe('DATABASE_URL');
    expect(result.config?.connectionString).toBe('postgresql://primary:pass@cloudsql.internal:5432/primary_db');
  });
});
