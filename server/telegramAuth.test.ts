import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { validateTelegramInitData } from './telegramAuth';

function generateValidTelegramInitData(
  botToken: string,
  user: { id: number; first_name?: string; last_name?: string; username?: string },
  authDate: number = Math.floor(Date.now() / 1000)
) {
  const userJson = JSON.stringify(user);
  const params: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: userJson,
  };

  const dataCheckArr = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`);
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return `auth_date=${params.auth_date}&query_id=${params.query_id}&user=${encodeURIComponent(userJson)}&hash=${hash}`;
}

describe('Telegram Auth HMAC-SHA256 & Security Verification Tests', () => {
  const TEST_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxyz';
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.BOT_TOKEN;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('1. production + отсутствует bot token → isValid=false and no fallback', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.BOT_TOKEN;

    const unverifiedInitData =
      'auth_date=1700000000&user=%7B%22id%22%3A123456%2C%22first_name%22%3A%22Attacker%22%7D&hash=fakehash123';

    const result = validateTelegramInitData(unverifiedInitData);
    expect(result.isValid).toBe(false);
    expect(result.user).toBeUndefined();
    expect(result.error).toContain('TELEGRAM_BOT_TOKEN is not configured');
  });

  it('2. development + отсутствует bot token → fallback works when running locally in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.BOT_TOKEN;

    const devInitData =
      'auth_date=1700000000&user=%7B%22id%22%3A999888%2C%22first_name%22%3A%22DevUser%22%7D&hash=fakehash123';

    const result = validateTelegramInitData(devInitData);
    expect(result.isValid).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user?.id).toBe(999888);
    expect(result.user?.first_name).toBe('DevUser');
  });

  it('3. неверная подпись (tampered data / hash) → isValid=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;

    const tamperedInitData =
      'auth_date=1700000000&user=%7B%22id%22%3A123456%7D&hash=badhash0000000000000000000000000000000000000000000000000000000000';

    const result = validateTelegramInitData(tamperedInitData);
    expect(result.isValid).toBe(false);
    expect(result.user).toBeUndefined();
    expect(result.error).toBe('Invalid hash signature');
  });

  it('4. корректная подпись → isValid=true with parsed user', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;

    const now = Math.floor(Date.now() / 1000);
    const validInitData = generateValidTelegramInitData(
      TEST_BOT_TOKEN,
      {
        id: 777123,
        first_name: 'Pavel',
        username: 'durov',
      },
      now
    );

    const result = validateTelegramInitData(validInitData);
    expect(result.isValid).toBe(true);
    expect(result.user?.id).toBe(777123);
    expect(result.user?.first_name).toBe('Pavel');
    expect(result.user?.username).toBe('durov');
    expect(result.authDate).toBe(now);
  });

  it('5. устаревший auth_date (> 7 дней) → isValid=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;

    const eightDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 8;
    const expiredInitData = generateValidTelegramInitData(
      TEST_BOT_TOKEN,
      {
        id: 777123,
        first_name: 'Pavel',
      },
      eightDaysAgo
    );

    const result = validateTelegramInitData(expiredInitData);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('InitData expired');
  });

  it('6. будущее время auth_date (> 5 минут вперед) → isValid=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;

    const futureTime = Math.floor(Date.now() / 1000) + 600; // 10 minutes in future
    const futureInitData = generateValidTelegramInitData(
      TEST_BOT_TOKEN,
      {
        id: 777123,
        first_name: 'Pavel',
      },
      futureTime
    );

    const result = validateTelegramInitData(futureInitData);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Future auth_date rejected');
  });

  it('7. отсутствие hash или пустой initData → isValid=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;

    expect(validateTelegramInitData('').isValid).toBe(false);
    expect(validateTelegramInitData(undefined).isValid).toBe(false);
    expect(validateTelegramInitData('user=%7B%22id%22%3A123%7D').isValid).toBe(false);
  });

  it('8. невалидный json или отсутствие поля id в user → isValid=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;

    const now = Math.floor(Date.now() / 1000);
    // User without id
    const invalidUserInitData = generateValidTelegramInitData(
      TEST_BOT_TOKEN,
      { first_name: 'NoId' } as any,
      now
    );

    const result = validateTelegramInitData(invalidUserInitData);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Missing or invalid user object');
  });
});
