import re

with open('server/invoiceService.test.ts', 'r') as f:
    content = f.read()

target = """  it('should ignore duplicate payment for already PAID invoice', async () => {"""

replacement = """  it('should handle concurrent duplicate telegram_payment_charge_id safely without throwing 500', async () => {
    const paymentRecordId = `pay_${Date.now()}`;
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'inv_123', user_id: '123456789', stars_amount: 100, status: 'PENDING' }] })
                    .mockRejectedValueOnce({ code: '23505' }); // Simulate unique constraint violation on insert

    const res = await processSuccessfulStarsPayment(
      {
        telegram_payment_charge_id: 'charge_123',
        total_amount: 100,
        currency: 'XTR',
        invoice_payload: JSON.stringify({ invoiceId: 'inv_123', userId: '123456789', stars: 100 }),
      },
      '123456789'
    );

    expect(res.success).toBe(true);
    expect(res.duplicate).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should ignore duplicate payment for already PAID invoice', async () => {"""

content = content.replace(target, replacement)

with open('server/invoiceService.test.ts', 'w') as f:
    f.write(content)
