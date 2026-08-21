import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  createStarsInvoice,
  validatePreCheckout,
  processSuccessfulStarsPayment,
  ALLOWED_STARS_AMOUNTS,
} from './invoiceService';
import * as marketRepository from './marketRepository';
import * as telegramAuth from './telegramAuth';

describe('Telegram Stars Invoices & Payment Lifecycle Protection', () => {
  let mockClient: any;
  let mockPool: any;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    };

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    vi.spyOn(marketRepository, 'getPgPool').mockReturnValue(mockPool as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('1. Создание разрешённого invoice: сохраняет в te_invoices с PENDING и возвращает invoiceLink', async () => {
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: true,
      user: { id: 777888, first_name: 'Alex' },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ ok: true, result: 'https://t.me/$invoice_link_123' }),
    } as any);

    mockClient.query.mockResolvedValue({ rows: [] });

    const res = await createStarsInvoice({
      initData: 'valid_init_data',
      starsAmount: 100,
      idempotencyKey: 'idem_key_abc',
    });

    expect(res.success).toBe(true);
    expect(res.invoiceLink).toBe('https://t.me/$invoice_link_123');
    expect(res.starsAmount).toBe(100);
    expect(res.currency).toBe('XTR');
    expect(res.payload).toContain('777888');

    // Проверяем вызовы БД
    const insertCall = mockClient.query.mock.calls.find((c: any[]) =>
      c[0].includes('INSERT INTO te_invoices')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][1]).toBe('777888'); // verified user_id
    expect(insertCall[1][2]).toBe(100); // stars_amount
    expect(insertCall[1][3]).toBe('XTR'); // currency
    expect(insertCall[1][6]).toBe('idem_key_abc'); // idempotency_key

    fetchSpy.mockRestore();
  });

  it('2. Запрещённая сумма Stars: отклоняется до вызова Telegram API и БД', async () => {
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: true,
      user: { id: 777888 },
    });

    const res = await createStarsInvoice({
      initData: 'valid_init_data',
      starsAmount: 99999, // Unlisted amount
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('INVALID_AMOUNT');
    expect(res.error).toContain('Invalid stars amount');
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('3. Подмена user ID в initData: невалидная подпись отклоняется', async () => {
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: false,
      user: undefined,
    });

    const res = await createStarsInvoice({
      initData: 'tampered_init_data',
      starsAmount: 50,
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('INVALID_AUTH');
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('4. Подмена payload в pre-checkout: отклоняется при несовпадении user ID или суммы', async () => {
    const pcq = {
      id: 'pcq_123',
      from: { id: 999999 }, // Attacker trying to approve invoice of user 777888
      currency: 'XTR',
      total_amount: 100,
      invoice_payload: JSON.stringify({
        invoiceId: 'inv_123',
        userId: '777888',
        stars: 100,
      }),
    };

    const result = await validatePreCheckout(pcq);
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('User ID mismatch');
  });

  it('5. Pre-checkout для уже оплаченного или ненайденного invoice отклоняется', async () => {
    const pcq = {
      id: 'pcq_123',
      from: { id: 777888 },
      currency: 'XTR',
      total_amount: 100,
      invoice_payload: JSON.stringify({
        invoiceId: 'inv_already_paid',
        userId: '777888',
        stars: 100,
      }),
    };

    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'inv_already_paid', user_id: '777888', stars_amount: 100, status: 'PAID' }],
    });

    const result = await validatePreCheckout(pcq);
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('already been paid');
  });

  it('6. Корректное однократное зачисление Stars в ACID-транзакции', async () => {
    const invoiceId = 'inv_test_001';
    const userId = '777888';
    const starsAmount = 250;
    const chargeId = 'tg_charge_abc123';

    // Mock query sequences:
    // 1: BEGIN
    // 2: SELECT invoice FOR UPDATE
    // 3: SELECT te_payments
    // 4: INSERT INTO te_balances ON CONFLICT ... RETURNING
    // 5: UPDATE te_invoices SET status = 'PAID'
    // 6: INSERT INTO te_payments
    // 7: INSERT INTO te_financial_audits
    // 8: INSERT INTO te_outbox_events
    // 9: COMMIT
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: invoiceId, user_id: userId, stars_amount: starsAmount, status: 'PENDING' }],
      }) // SELECT invoice
      .mockResolvedValueOnce({ rows: [] }) // SELECT te_payments
      .mockResolvedValueOnce({
        rows: [
          { available_before: '50', available_after: '300', locked_before: '0', locked_after: '0' },
        ],
      }) // INSERT te_balances RETURNING
      .mockResolvedValueOnce({}) // UPDATE te_invoices
      .mockResolvedValueOnce({}) // INSERT te_payments
      .mockResolvedValueOnce({}) // INSERT te_financial_audits
      .mockResolvedValueOnce({}) // INSERT te_outbox_events
      .mockResolvedValueOnce({}); // COMMIT

    const payment = {
      currency: 'XTR',
      total_amount: starsAmount,
      invoice_payload: JSON.stringify({ invoiceId, userId, stars: starsAmount }),
      telegram_payment_charge_id: chargeId,
      provider_payment_charge_id: 'tg_prov_123',
    };

    const res = await processSuccessfulStarsPayment(payment, userId);
    expect(res.success).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(res.starsCredited).toBe(250);
    expect(res.balanceAfter).toBe('300'); // 50 + 250

    // Проверяем вызовы базы данных
    const balanceUpdate = mockClient.query.mock.calls.find((c: any[]) =>
      c[0].includes('INSERT INTO te_balances')
    );
    expect(balanceUpdate[1][1]).toBe('250');

    const auditCall = mockClient.query.mock.calls.find((c: any[]) =>
      c[0].includes('INSERT INTO te_financial_audits')
    );
    expect(auditCall[1][0]).toBe('STARS_DEPOSIT_COMPLETED');
    expect(auditCall[1][4]).toBe('250');
    expect(auditCall[1][5]).toBe('50'); // available_before
    expect(auditCall[1][6]).toBe('300'); // available_after
  });

  it('7. Повторный successful payment (Duplicate webhook): не увеличивает баланс повторно', async () => {
    const invoiceId = 'inv_test_001';
    const userId = '777888';
    const starsAmount = 250;
    const chargeId = 'tg_charge_abc123';

    // Invoice is already marked as PAID
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: invoiceId, user_id: userId, stars_amount: starsAmount, status: 'PAID' }],
      })
      .mockResolvedValueOnce({}); // ROLLBACK

    const payment = {
      currency: 'XTR',
      total_amount: starsAmount,
      invoice_payload: JSON.stringify({ invoiceId, userId, stars: starsAmount }),
      telegram_payment_charge_id: chargeId,
    };

    const res = await processSuccessfulStarsPayment(payment, userId);
    expect(res.success).toBe(true);
    expect(res.duplicate).toBe(true); // Flagged as duplicate

    // Убеждаемся, что запрос на обновление баланса НЕ вызывался
    const balanceUpdate = mockClient.query.mock.calls.find((c: any[]) =>
      c[0].includes('INSERT INTO te_balances')
    );
    expect(balanceUpdate).toBeUndefined();
  });

  it('8. Payment для другого пользователя (Sender spoofing): немедленно отклоняется', async () => {
    const invoiceId = 'inv_test_001';
    const legitimateUserId = '777888';
    const attackerTelegramId = '999999';

    const payment = {
      currency: 'XTR',
      total_amount: 100,
      invoice_payload: JSON.stringify({ invoiceId, userId: legitimateUserId, stars: 100 }),
      telegram_payment_charge_id: 'charge_tampered',
    };

    const res = await processSuccessfulStarsPayment(payment, attackerTelegramId);
    expect(res.success).toBe(false);
    expect(res.code).toBe('USER_MISMATCH');
    expect(res.error).toContain('Security violation');
  });

  it('9. Падение базы данных во время транзакции: выполняет полный ROLLBACK', async () => {
    const invoiceId = 'inv_db_fail';
    const userId = '777888';
    const starsAmount = 100;

    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('PostgreSQL Connection Severed')); // Query fails

    const payment = {
      currency: 'XTR',
      total_amount: starsAmount,
      invoice_payload: JSON.stringify({ invoiceId, userId, stars: starsAmount }),
      telegram_payment_charge_id: 'charge_fail_1',
    };

    const res = await processSuccessfulStarsPayment(payment, userId);
    expect(res.success).toBe(false);
    expect(res.code).toBe('DB_ERROR');

    const rollbackCall = mockClient.query.mock.calls.find((c: any[]) => c[0] === 'ROLLBACK');
    expect(rollbackCall).toBeDefined();
  });

  it('10. Ошибка Telegram API при создании invoice: помечает invoice как FAILED', async () => {
    vi.spyOn(telegramAuth, 'validateTelegramInitData').mockReturnValue({
      isValid: true,
      user: { id: 777888 },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ ok: false, description: 'BOT_PAYMENTS_DISABLED' }),
    } as any);

    mockClient.query.mockResolvedValue({ rows: [] });

    const res = await createStarsInvoice({
      initData: 'valid_init_data',
      starsAmount: 100,
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('TELEGRAM_API_ERROR');
    expect(res.error).toBe('BOT_PAYMENTS_DISABLED');

    // Verify invoice marked as FAILED in database
    const failedUpdateCall = mockClient.query.mock.calls.find((c: any[]) =>
      c[0].includes("status = 'FAILED'")
    );
    expect(failedUpdateCall).toBeDefined();
    expect(failedUpdateCall[1][0]).toContain('BOT_PAYMENTS_DISABLED');

    fetchSpy.mockRestore();
  });
});
