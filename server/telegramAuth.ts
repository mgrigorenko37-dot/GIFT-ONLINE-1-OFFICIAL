import crypto from 'crypto';

export interface ValidatedTelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramAuthResult {
  isValid: boolean;
  user?: ValidatedTelegramUser;
  authDate?: number;
  rawInitData?: string;
  error?: string;
}

/**
 * Validates Telegram Mini App initData string against BOT_TOKEN using HMAC-SHA256
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string | undefined | null,
  botToken: string | undefined = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN
): TelegramAuthResult {
  if (!initData || typeof initData !== 'string') {
    return { isValid: false, error: 'Empty initData' };
  }

  const isProduction = process.env.NODE_ENV === 'production';

  try {
    const searchParams = new URLSearchParams(initData);
    const hash = searchParams.get('hash');

    if (!hash) {
      return { isValid: false, error: 'Missing hash in initData' };
    }

    // In production, TELEGRAM_BOT_TOKEN is strictly mandatory and unverified fallback is banned
    if (!botToken) {
      if (isProduction) {
        return {
          isValid: false,
          error: 'Production configuration error: TELEGRAM_BOT_TOKEN is not configured',
        };
      }

      // Development / Test only fallback when bot token is not configured locally
      const userRaw = searchParams.get('user');
      if (userRaw) {
        try {
          const user = JSON.parse(userRaw) as ValidatedTelegramUser;
          return {
            isValid: true,
            user,
            authDate: Number(searchParams.get('auth_date')) || Date.now(),
            rawInitData: initData,
          };
        } catch {
          // ignore
        }
      }
      return { isValid: false, error: 'TELEGRAM_BOT_TOKEN is not configured on server' };
    }

    searchParams.delete('hash');

    // Sort keys alphabetically
    const dataCheckArr: string[] = [];
    Array.from(searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([key, value]) => {
        dataCheckArr.push(`${key}=${value}`);
      });

    const dataCheckString = dataCheckArr.join('\n');

    // secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

    // calculated_hash = HMAC_SHA256(secret_key, data_check_string)
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const calculatedBuffer = Buffer.from(calculatedHash, 'utf8');
    const hashBuffer = Buffer.from(hash, 'utf8');
    if (
      calculatedBuffer.length !== hashBuffer.length ||
      !crypto.timingSafeEqual(calculatedBuffer, hashBuffer)
    ) {
      return { isValid: false, error: 'Invalid hash signature' };
    }

    // Check auth_date for expiration (max 7 days / 604800 seconds to protect active sessions while preventing replay attacks)
    const authDate = Number(searchParams.get('auth_date'));
    if (!authDate || Number.isNaN(authDate)) {
      return { isValid: false, error: 'Missing or invalid auth_date' };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    // Reject future auth_date with a 5-minute clock drift margin
    if (authDate > nowSeconds + 300) {
      return { isValid: false, error: 'Future auth_date rejected' };
    }

    // 7-day TTL window (86400 * 7 seconds)
    if (nowSeconds - authDate > 86400 * 7) {
      return { isValid: false, error: 'InitData expired' };
    }

    let user: ValidatedTelegramUser | undefined;
    const userString = searchParams.get('user');
    if (userString) {
      user = JSON.parse(userString) as ValidatedTelegramUser;
    }

    if (!user || typeof user.id !== 'number') {
      return { isValid: false, error: 'Missing or invalid user object in initData' };
    }

    return {
      isValid: true,
      user,
      authDate,
      rawInitData: initData,
    };
  } catch (err: any) {
    return { isValid: false, error: `Parse error: ${err.message}` };
  }
}
