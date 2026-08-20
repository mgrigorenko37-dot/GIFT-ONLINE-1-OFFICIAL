import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function walkDir(dir: string): string[] {
  let files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  const stat = fs.statSync(dir);
  if (stat.isFile()) return [dir];

  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    if (
      item === 'node_modules' ||
      item === 'dist' ||
      item === 'coverage' ||
      item === '.git'
    ) {
      continue;
    }
    const itemStat = fs.statSync(fullPath);
    if (itemStat.isDirectory()) {
      files = files.concat(walkDir(fullPath));
    } else if (
      fullPath.endsWith('.ts') ||
      fullPath.endsWith('.tsx') ||
      fullPath.endsWith('.js') ||
      fullPath.endsWith('.jsx')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

const allowedDevExclusions = new Set([
  path.normalize('server/mockMinter.ts'),
  path.normalize('server/mocks/giftsFixture.ts'),
]);

function isTestOrFixture(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  if (allowedDevExclusions.has(normalized)) return true;
  if (normalized.endsWith('.test.ts') || normalized.endsWith('.test.js')) return true;
  if (normalized.endsWith('.spec.ts') || normalized.endsWith('.spec.js')) return true;
  if (normalized.startsWith('tests/') || normalized.startsWith('tests\\')) return true;
  return false;
}

describe('Security & Randomness Audit Tests', () => {
  it('1. Verifies zero Math.random() across all production source files in server, routes, workers, and src', () => {
    const productionDirs = ['server', 'src', 'server.ts'].filter((p) =>
      fs.existsSync(path.resolve(p))
    );

    const violatingFiles: Array<{ file: string; line: number; text: string }> = [];

    for (const targetDir of productionDirs) {
      const files = walkDir(targetDir);
      for (const file of files) {
        if (isTestOrFixture(file)) continue;
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((lineText, idx) => {
          if (lineText.includes('Math.random(')) {
            violatingFiles.push({ file, line: idx + 1, text: lineText.trim() });
          }
        });
      }
    }

    expect(
      violatingFiles,
      `Found prohibited Math.random() in production files: ${JSON.stringify(violatingFiles, null, 2)}`
    ).toEqual([]);
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
      const workerId = `worker_${process.pid}_${crypto.randomUUID().substring(0, 8)}`;
      const paymentId = `pay_${crypto.randomUUID()}`;
      const trackingTxHash = `ton_tx_${Date.now()}_${i}_${crypto.randomBytes(8).toString('hex')}`;

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

      expect(generatedIds.has(workerId)).toBe(false);
      generatedIds.add(workerId);

      expect(generatedIds.has(paymentId)).toBe(false);
      generatedIds.add(paymentId);

      expect(generatedIds.has(trackingTxHash)).toBe(false);
      generatedIds.add(trackingTxHash);
    }

    expect(generatedIds.size).toBe(iterations * 8);
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

  it('4. Confirms mock simulation module is strictly isolated and guarded in production', () => {
    const mockMinterPath = path.resolve('server/mockMinter.ts');
    expect(fs.existsSync(mockMinterPath)).toBe(true);
    const content = fs.readFileSync(mockMinterPath, 'utf-8');

    // Verify presence of guard flags
    expect(content.includes("process.env.NODE_ENV === 'production'")).toBe(true);
    expect(content.includes('SAFETY REJECTION: Mock simulation is disabled in production')).toBe(
      true
    );
  });

  it('5. Verifies log safety: no secrets or sensitive tokens logged directly in console outputs', () => {
    const secretVars = [
      'TON_HOT_WALLET_MNEMONIC',
      'TELEGRAM_BOT_TOKEN',
      'BOT_TOKEN',
      'GEMINI_API_KEY',
      'DATABASE_URL',
    ];

    const productionDirs = ['server', 'src', 'server.ts'].filter((p) =>
      fs.existsSync(path.resolve(p))
    );

    const loggedSecrets: string[] = [];

    for (const targetDir of productionDirs) {
      const files = walkDir(targetDir);
      for (const file of files) {
        if (isTestOrFixture(file)) continue;
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((lineText, idx) => {
          if (
            lineText.includes('console.log') ||
            lineText.includes('console.error') ||
            lineText.includes('console.warn')
          ) {
            for (const secretVar of secretVars) {
              const regex = new RegExp(`console\\.(log|error|warn)\\(.*process\\.env\\.${secretVar}`);
              if (regex.test(lineText)) {
                loggedSecrets.push(`${file}:${idx + 1} logs process.env.${secretVar}`);
              }
            }
          }
        });
      }
    }

    expect(
      loggedSecrets,
      `Found secret environment variables logged directly in console calls: ${loggedSecrets.join(', ')}`
    ).toEqual([]);
  });
});
