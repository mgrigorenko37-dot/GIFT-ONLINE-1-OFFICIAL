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

  const prod = isProduction ?? process.env.NODE_ENV === 'production';
  const list = allowedList ?? parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

  const cleanOrigin = origin.trim().replace(/\/+$/, '').toLowerCase();

  // 2. Check explicit allowlist (case-insensitive match)
  if (list.some((allowed) => allowed.toLowerCase() === cleanOrigin)) {
    return true;
  }

  // 3. Localhost & 127.0.0.1 allowed in dev / test environments
  if (!prod) {
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0') {
        return true;
      }
    } catch {
      return false;
    }
  }

  // 4. Production strictly rejects anything not in ALLOWED_ORIGINS
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
    callback(new Error(`CORS blocked: Origin ${origin || 'unknown'} is not allowed by policy.`));
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
