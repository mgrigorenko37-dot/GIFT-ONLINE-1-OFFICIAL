import { PoolConfig } from 'pg';

export interface PostgresConfigResult {
  isConfigured: boolean;
  source: 'DATABASE_URL' | 'SQL_LEGACY' | 'NONE';
  config: PoolConfig | null;
}

/**
 * Unified PostgreSQL configuration provider.
 * Priority:
 * 1. DATABASE_URL: Primary source for production and standard deployment.
 * 2. SQL_* (SQL_HOST, SQL_PORT, SQL_USER, SQL_PASSWORD, SQL_DATABASE / SQL_DB_NAME): Optional fallback for local dev.
 */
export function getPostgresConfig(): PostgresConfigResult {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return {
      isConfigured: true,
      source: 'DATABASE_URL',
      config: {
        connectionString: databaseUrl,
        max: 20,
      },
    };
  }

  const sqlHost = process.env.SQL_HOST?.trim();
  if (sqlHost) {
    const portStr = process.env.SQL_PORT?.trim();
    const port = portStr ? parseInt(portStr, 10) : 5432;
    const user = process.env.SQL_USER || process.env.PGUSER;
    const password = process.env.SQL_PASSWORD || process.env.PGPASSWORD;
    const database = process.env.SQL_DATABASE || process.env.SQL_DB_NAME || process.env.PGDATABASE;

    return {
      isConfigured: true,
      source: 'SQL_LEGACY',
      config: {
        host: sqlHost,
        port: Number.isNaN(port) ? 5432 : port,
        user,
        password,
        database,
        max: 20,
      },
    };
  }

  return {
    isConfigured: false,
    source: 'NONE',
    config: null,
  };
}

/**
 * Returns true if PostgreSQL connection parameters are configured.
 */
export function isPostgresConfigured(): boolean {
  return getPostgresConfig().isConfigured;
}

/**
 * Returns a sanitized diagnostic string describing the target database without exposing secrets.
 */
export function getSanitizedDbTarget(): string {
  const { isConfigured, source } = getPostgresConfig();
  if (!isConfigured) return 'none';
  if (source === 'DATABASE_URL') {
    try {
      const url = new URL(process.env.DATABASE_URL!);
      const auth = url.username ? `${url.username}:***@` : '';
      return `${url.protocol}//${auth}${url.host}${url.pathname}`;
    } catch {
      return 'DATABASE_URL (configured)';
    }
  }
  const host = process.env.SQL_HOST;
  const port = process.env.SQL_PORT || 5432;
  const db = process.env.SQL_DATABASE || process.env.SQL_DB_NAME || 'default';
  return `postgres://${host}:${port}/${db}`;
}

/**
 * Returns detailed diagnostic information without exposing secrets.
 */
export function getDbDiagnostics(): Record<string, string | boolean> {
  const { isConfigured, source, config } = getPostgresConfig();
  if (!isConfigured || !config) {
    return { status: 'Not Configured' };
  }

  if (source === 'DATABASE_URL' && config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      return {
        host: url.hostname,
        port: url.port || '5432',
        database: url.pathname.replace('/', ''),
        user: url.username || 'unknown',
        hasPassword: !!url.password,
      };
    } catch {
      return { error: 'Invalid DATABASE_URL format' };
    }
  }

  if (source === 'SQL_LEGACY') {
    return {
      host: String(config.host),
      port: String(config.port),
      database: String(config.database),
      user: String(config.user),
      hasPassword: !!config.password,
    };
  }

  return { status: 'Unknown State' };
}
