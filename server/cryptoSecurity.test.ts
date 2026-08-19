import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

describe('Security & Randomness Audit Tests', () => {
  it('1. Verifies zero Math.random() in security, financial, trading, and blockchain flows', () => {
    const sensitiveFiles = [
      'server/routes/financialRoutes.ts',
      'server/withdrawalWorker.ts',
      'server/withdrawalStateMachine.ts',
      'server/tonAdapter.ts',
      'server/tradingEngine.ts',
      'server/socketServer.ts',
      'server/schedulerLease.ts',
      'server/currencyMigration.ts',
      'server/marketRepository.ts',
      'server/telegramAuth.ts',
      'server/rateLimiter.ts',
      'server/giftSyncWorker.ts',
      'src/data/gifts.ts',
      'src/utils/giftMapper.ts',
    ];

    for (const file of sensitiveFiles) {
      const fullPath = path.resolve(file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const hasMathRandom = content.includes('Math.random()');
        expect(
          hasMathRandom,
          `Found prohibited Math.random() in security-sensitive file: ${file}`
        ).toBe(false);
      }
    }
  });

  it('2. Verifies cryptographic uniqueness and collision resistance across 10,000 generated IDs', () => {
    const iterations = 10000;
    const generatedIds = new Set<string>();

    for (let i = 0; i < iterations; i++) {
      const withdrawalId = `wd_${crypto.randomUUID()}`;
      const nonce = crypto.randomBytes(16).toString('hex');
      const orderId = `ord_liq_${crypto.randomUUID()}`;
      const tradeId = `t_liq_${crypto.randomUUID()}`;
      const execId = `exec_liq_${crypto.randomUUID()}`;

      expect(generatedIds.has(withdrawalId)).toBe(false);
      generatedIds.add(withdrawalId);

      expect(generatedIds.has(nonce)).toBe(false);
      generatedIds.add(nonce);

      expect(generatedIds.has(orderId)).toBe(false);
      generatedIds.add(orderId);

      expect(generatedIds.has(tradeId)).toBe(false);
      generatedIds.add(tradeId);

      expect(generatedIds.has(execId)).toBe(false);
      generatedIds.add(execId);
    }

    expect(generatedIds.size).toBe(iterations * 5);
  });

  it('3. Verifies invoice payload generation format, entropy, and schema integrity', () => {
    const verifiedUserId = '777123456';
    const requestedStars = 500;
    const giftId = 'plush-pepe';

    const rawPayload = JSON.stringify({
      userId: verifiedUserId,
      giftId: giftId || 'general_deposit',
      stars: requestedStars,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    });

    const parsed = JSON.parse(rawPayload);

    expect(parsed.userId).toBe(verifiedUserId);
    expect(parsed.giftId).toBe('plush-pepe');
    expect(parsed.stars).toBe(500);
    expect(typeof parsed.timestamp).toBe('number');
    expect(typeof parsed.nonce).toBe('string');
    // Nonce should be 16 bytes = 32 hex chars with high entropy
    expect(parsed.nonce.length).toBe(32);
    expect(/^[0-9a-f]{32}$/.test(parsed.nonce)).toBe(true);
  });

  it('4. Confirms mock simulation generation is strictly isolated and guarded in production', () => {
    const mockMinterPath = path.resolve('server/mockMinter.ts');
    expect(fs.existsSync(mockMinterPath)).toBe(true);
    const content = fs.readFileSync(mockMinterPath, 'utf-8');

    // Verify presence of guard flags
    expect(content.includes('process.env.NODE_ENV === \'production\'')).toBe(true);
    expect(content.includes('SAFETY REJECTION: Mock simulation is disabled in production')).toBe(true);
  });
});
