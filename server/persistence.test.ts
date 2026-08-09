import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  FilePersistentMarketRepository,
  resolveMarketRepository,
  MarketSnapshot,
} from './marketRepository';

describe('Production Persistence & Safety Tests', () => {
  const testFilePath = path.join(process.cwd(), '.test_market_snapshot.json');
  const testBackupPath = `${testFilePath}.bak`;

  afterEach(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    if (fs.existsSync(testBackupPath)) fs.unlinkSync(testBackupPath);
  });

  it('FilePersistentMarketRepository creates backup and recovers from corrupted primary file', async () => {
    const repo = new FilePersistentMarketRepository(testFilePath);

    const snapshot1: MarketSnapshot = {
      version: 1,
      timestamp: 1000,
      allSales: [
        {
          id: 'sale_001',
          collectionId: 'durov-cap',
          currency: 'TON',
          price: '100',
          quantity: '1',
          eventTime: 1000,
          status: 'completed',
        },
      ],
      processedSaleIds: ['sale_001'],
      activeCandles: {},
      closedCandles: {},
    };

    // Save initial valid snapshot
    await repo.saveSnapshot(snapshot1);
    expect(fs.existsSync(testFilePath)).toBe(true);

    const snapshot2: MarketSnapshot = {
      ...snapshot1,
      timestamp: 2000,
      processedSaleIds: ['sale_001', 'sale_002'],
    };

    // Save second snapshot (this generates backup of snapshot1)
    await repo.saveSnapshot(snapshot2);
    expect(fs.existsSync(testBackupPath)).toBe(true);

    // Corrupt primary file
    fs.writeFileSync(testFilePath, '{ CORRUPTED_INVALID_JSON_DATA... }', 'utf-8');

    // Attempt load -> should automatically fall back to backup snapshot
    const loaded = repo.loadSnapshot();
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.processedSaleIds).toContain('sale_001');
  });

  it('resolveMarketRepository throws error in production when DATABASE_URL is missing', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origDbUrl = process.env.DATABASE_URL;
    const origAllowFile = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      delete process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;

      expect(() => resolveMarketRepository()).toThrow(
        /Production mode requires DATABASE_URL for Postgres persistence/
      );
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origDbUrl) process.env.DATABASE_URL = origDbUrl;
      if (origAllowFile) process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = origAllowFile;
    }
  });

  it('resolveMarketRepository ignores ALLOW_FILE_STORAGE_IN_PRODUCTION=true in production and throws error', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origDbUrl = process.env.DATABASE_URL;
    const origStorage = process.env.STORAGE_MODE;
    const origAllowFile = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      process.env.STORAGE_MODE = 'file';
      process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = 'true';

      expect(() => resolveMarketRepository()).toThrow('CRITICAL CONFIGURATION ERROR');
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origDbUrl) process.env.DATABASE_URL = origDbUrl;
      if (origStorage) process.env.STORAGE_MODE = origStorage;
      if (origAllowFile) process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = origAllowFile;
    }
  });
});
