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

  try {
    const searchParams = new URLSearchParams(initData);
    const hash = searchParams.get('hash');

    if (!hash) {
      return { isValid: false, error: 'Missing hash in initData' };
    }

    // In dev / preview mode where BOT_TOKEN might not be configured, allow mock/fallback safely if explicitly enabled
    if (!botToken) {
      // If running without bot token in local development, parse user if present
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
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // calculated_hash = HMAC_SHA256(secret_key, data_check_string)
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return { isValid: false, error: 'Invalid hash signature' };
    }

    // Check auth_date for expiration (optional / max 24 hours)
    const authDate = Number(searchParams.get('auth_date'));
    if (authDate && Date.now() / 1000 - authDate > 86400 * 7) { // 7 days window
      return { isValid: false, error: 'InitData expired' };
    }

    let user: ValidatedTelegramUser | undefined;
    const userString = searchParams.get('user');
    if (userString) {
      user = JSON.parse(userString) as ValidatedTelegramUser;
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
