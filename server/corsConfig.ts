import { CorsOptions } from 'cors';

/**
 * Parses comma-separated list of allowed origins from environment.
 * Trims whitespace and removes trailing slashes.
 */
export function parseAllowedOrigins(rawEnv?: string): string[] {
  if (!rawEnv || typeof rawEnv !== 'string') return [];
  return rawEnv
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Validates whether an incoming HTTP Origin is permitted under current environment rules.
 *
 * Rules:
 * 1. Missing origin (!origin): Allowed. Used by server-to-server calls, webhooks, mobile native clients, and curl.
 * 2. In non-production (development / test):
 *    - Explicit ALLOWED_ORIGINS are allowed.
 *    - All localhost and 127.0.0.1 origins (on any port) are allowed for local development.
 * 3. In production:
 *    - ONLY explicitly listed ALLOWED_ORIGINS are allowed.
 *    - Wildcards ('*') and arbitrary unlisted origins are strictly forbidden.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedList?: string[],
  isProduction?: boolean
): boolean {
  // 1. Server-to-server, curl, webhooks, or native apps without Origin header
  if (!origin) {
    return true;
  }

  const list = allowedList ?? parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  const isProd = isProduction ?? (process.env.NODE_ENV === 'production');

  const cleanOrigin = origin.trim().replace(/\/+$/, '').toLowerCase();

  // Check explicit allowlist
  if (list.includes('*') || list.some((allowed) => allowed.toLowerCase() === cleanOrigin)) {
    return true;
  }

  // In production, strictly deny if not explicitly in allowlist
  if (isProd) {
    return false;
  }

  // In development / test mode, permit localhost and recognized dev hostnames
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.run.app') ||
      host.endsWith('.telegram.org') ||
      host.endsWith('.t.me') ||
      host.endsWith('.github.io')
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Common CORS Origin Delegate function for Express and Socket.IO.
 */
export function corsOriginDelegate(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

  if (isOriginAllowed(origin, allowedOrigins, isProd)) {
    callback(null, true);
  } else {
    callback(new Error(`CORS blocked: Origin ${origin} not allowed`));
  }
}

/**
 * Express CORS Options.
 * Credentials are set to false by default because authentication is stateless and uses
 * explicit headers (x-telegram-init-data, Authorization) rather than ambient cookies.
 */
export function getExpressCorsOptions(): CorsOptions {
  return {
    origin: corsOriginDelegate,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-telegram-init-data',
      'x-demo-auth',
      'x-idempotency-key',
    ],
    maxAge: 86400,
  };
}

/**
 * Socket.IO CORS Options.
 */
export function getSocketCorsOptions(): {
  origin: typeof corsOriginDelegate;
  credentials: boolean;
} {
  return {
    origin: corsOriginDelegate,
    credentials: false,
  };
}
