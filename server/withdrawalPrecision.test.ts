import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { validateAndConvertToNano, MockTonTransferAdapter, MAX_TON_AMOUNT } from './tonAdapter';

describe('Financial Withdrawal Precision & Validation', () => {
  describe('validateAndConvertToNano', () => {
    it('correctly handles minimum nanoTON unit (0.000000001 TON)', () => {
      const res = validateAndConvertToNano('0.000000001');
      expect(res.isValid).toBe(true);
      expect(res.nanoTon).toBe(1n);
      expect(res.amountDecimal?.toFixed()).toBe('0.000000001');
    });

    it('accepts 9 decimal places (1.234567891 TON) and rejects 10 decimal places (1.2345678912 TON)', () => {
      const validRes = validateAndConvertToNano('1.234567891');
      expect(validRes.isValid).toBe(true);
      expect(validRes.nanoTon).toBe(1234567891n);

      const invalidRes = validateAndConvertToNano('1.2345678912');
      expect(invalidRes.isValid).toBe(false);
      expect(invalidRes.error).toContain('exceeds maximum precision of 9 decimal places');
    });

    it('rejects amount with 10 decimal places (0.0000000001 TON)', () => {
      const res = validateAndConvertToNano('0.0000000001');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('exceeds maximum precision of 9 decimal places');
    });

    it('correctly handles large valid amounts without precision loss (100,000,000 TON)', () => {
      const res = validateAndConvertToNano('100000000');
      expect(res.isValid).toBe(true);
      expect(res.nanoTon).toBe(100000000000000000n);
      expect(res.amountDecimal?.toString()).toBe('100000000');
    });

    it('guarantees complete absence of floating-point precision loss for high precision string amounts', () => {
      const amountStr = '123456789.987654321';
      const res = validateAndConvertToNano(amountStr);
      expect(res.isValid).toBe(true);
      expect(res.nanoTon).toBe(123456789987654321n);
      expect(res.amountDecimal?.toString()).toBe('123456789.987654321');
    });

    it('accepts Decimal instances as well as string inputs', () => {
      const dec = new Decimal('2.500000001');
      const res = validateAndConvertToNano(dec);
      expect(res.isValid).toBe(true);
      expect(res.nanoTon).toBe(2500000001n);
      expect(res.amountDecimal?.toString()).toBe('2.500000001');
    });

    it('rejects negative amounts', () => {
      const res1 = validateAndConvertToNano('-0.000000001');
      expect(res1.isValid).toBe(false);
      expect(res1.error).toContain('must be positive');

      const res2 = validateAndConvertToNano('-5.5');
      expect(res2.isValid).toBe(false);
      expect(res2.error).toContain('must be positive');
    });

    it('rejects zero amount', () => {
      const res = validateAndConvertToNano('0');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('must be positive');
    });

    it('rejects amounts exceeding maximum allowed ceiling', () => {
      const ceilingExceeded = MAX_TON_AMOUNT.plus(1).toString();
      const res = validateAndConvertToNano(ceilingExceeded);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('exceeds maximum allowed ceiling');
    });

    it('rejects NaN, Infinity, -Infinity, and non-numeric strings', () => {
      expect(validateAndConvertToNano('NaN').isValid).toBe(false);
      expect(validateAndConvertToNano('Infinity').isValid).toBe(false);
      expect(validateAndConvertToNano('-Infinity').isValid).toBe(false);
      expect(validateAndConvertToNano('abc_invalid').isValid).toBe(false);
      expect(validateAndConvertToNano('1.2.3').isValid).toBe(false);
    });
  });

  describe('MockTonTransferAdapter with safe Decimal/string input', () => {
    it('processes valid transfers and records nanoTon bigint without precision loss', async () => {
      const adapter = new MockTonTransferAdapter();
      const res = await adapter.sendTon(
        'EQD123456789012345678901234567890123456789012345',
        '1.23456789'
      );

      expect(res.success).toBe(true);
      expect(adapter.sentTransfers.length).toBe(1);
      expect(adapter.sentTransfers[0].amount).toBe('1.23456789');
      expect(adapter.sentTransfers[0].nanoTon).toBe(1234567890n);
    });

    it('rejects invalid amounts passed to adapter', async () => {
      const adapter = new MockTonTransferAdapter();

      // 10 decimal places
      const res1 = await adapter.sendTon(
        'EQD123456789012345678901234567890123456789012345',
        '1.1234567891'
      );
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('exceeds maximum precision of 9 decimal places');

      // Negative amount
      const res2 = await adapter.sendTon(
        'EQD123456789012345678901234567890123456789012345',
        '-2.0'
      );
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('must be positive');

      expect(adapter.sentTransfers.length).toBe(0);
    });
  });
});
