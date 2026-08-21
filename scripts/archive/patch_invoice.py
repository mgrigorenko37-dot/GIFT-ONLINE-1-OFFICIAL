import re

with open('server/invoiceService.ts', 'r') as f:
    content = f.read()

target = """    // 6. Record payment in te_payments audit table
    const paymentRecordId = `pay_${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO te_payments (
        id, invoice_id, user_id, amount, currency, telegram_payment_charge_id,
        telegram_provider_charge_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8)`,
      [
        paymentRecordId,
        invoiceId,
        String(userId),
        starsAmountDecimal.toString(),
        'STARS',
        payment.telegram_payment_charge_id,
        payment.provider_payment_charge_id || null,
        now,
      ]
    );"""

replacement = """    // 6. Record payment in te_payments audit table
    const paymentRecordId = `pay_${crypto.randomUUID()}`;
    try {
      await client.query(
        `INSERT INTO te_payments (
          id, invoice_id, user_id, amount, currency, telegram_payment_charge_id,
          telegram_provider_charge_id, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8)`,
        [
          paymentRecordId,
          invoiceId,
          String(userId),
          starsAmountDecimal.toString(),
          'STARS',
          payment.telegram_payment_charge_id,
          payment.provider_payment_charge_id || null,
          now,
        ]
      );
    } catch (e: any) {
      if (e.code === '23505') {
        await client.query('ROLLBACK');
        console.log(`[InvoicePayment] Duplicate charge_id ${payment.telegram_payment_charge_id} caught on insert.`);
        return {
          success: true,
          duplicate: true,
          invoiceId,
          userId: String(userId),
        };
      }
      throw e;
    }"""

content = content.replace(target, replacement)

with open('server/invoiceService.ts', 'w') as f:
    f.write(content)

