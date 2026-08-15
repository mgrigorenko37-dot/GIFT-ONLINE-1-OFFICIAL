import { describe, test, expect } from 'vitest';
import {
  clearMarketState,
  acceptCompletedSale,
  serializeMarketState,
  restoreMarketState,
  allSales,
  processedSaleIds,
  activeCandles,
  closedCandles,
  getMarketCandlesHistory,
  setMarketRepository,
  getMarketRepository,
} from './marketState';
import {
  InMemoryMarketRepository,
  FilePersistentMarketRepository,
  MarketSnapshot,
} from './marketRepository';
import path from 'path';
import fs from 'fs';

const instKey = 'durov-cap:all:all:TON';
const tf1m = '1m';

describe('Stage 15: Reliable Market Data Recovery Scenarios', () => {
  test('Scenario 1: Basic Save -> Clear Memory -> Restore -> New Sale -> Duplicate Sale', () => {
    delete process.env.SIMULATION_MODE;
    clearMarketState();
    const baseTime = 1710000000000;

    const sale1Res = acceptCompletedSale({
      id: 'rec-sale-1',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '100',
      quantity: '1',
      eventTime: baseTime,
      status: 'completed',
    });
    expect(sale1Res.accepted).toBe(true);

    const sale2Res = acceptCompletedSale({
      id: 'rec-sale-2',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '110',
      quantity: '2',
      eventTime: baseTime + 10000,
      status: 'completed',
    });
    expect(sale2Res.accepted).toBe(true);

    const sale3Res = acceptCompletedSale({
      id: 'rec-sale-3',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '120',
      quantity: '1',
      eventTime: baseTime + 60000,
      status: 'completed',
    });
    expect(sale3Res.accepted).toBe(true);

    expect(allSales.length).toBe(3);
    expect(processedSaleIds.size).toBe(3);
    expect(closedCandles[instKey][tf1m].length).toBe(1);
    expect(activeCandles[instKey][tf1m]).toBeDefined();

    const preSnapshot = serializeMarketState();
    expect(preSnapshot.allSales.length).toBe(3);

    clearMarketState();
    expect(allSales.length).toBe(0);
    expect(processedSaleIds.size).toBe(0);

    const restoreRes = restoreMarketState(preSnapshot);
    expect(restoreRes.success).toBe(true);
    expect(restoreRes.restoredSalesCount).toBe(3);

    expect(allSales.length).toBe(3);
    expect(processedSaleIds.size).toBe(3);
    expect(closedCandles[instKey][tf1m].length).toBe(1);
    expect(closedCandles[instKey][tf1m][0].close).toBe('110');
    expect(activeCandles[instKey][tf1m].open).toBe('120');

    const sale4Res = acceptCompletedSale({
      id: 'rec-sale-4',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '130',
      quantity: '1',
      eventTime: baseTime + 70000,
      status: 'completed',
    });
    expect(sale4Res.accepted).toBe(true);

    const activeCandle = activeCandles[instKey][tf1m];
    expect(activeCandle.open).toBe('120');
    expect(activeCandle.high).toBe('130');
    expect(activeCandle.close).toBe('130');

    const dupRes = acceptCompletedSale({
      id: 'rec-sale-1',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '100',
      quantity: '1',
      eventTime: baseTime,
      status: 'completed',
    });

    expect(dupRes.accepted).toBe(false);
    expect(dupRes.reason).toBe('duplicate');
    expect(allSales.length).toBe(4);
  });

  test('Scenario 2: FilePersistentMarketRepository End-to-End Test', async () => {
    clearMarketState();
    const testFilePath = path.join(process.cwd(), '.test_market_recovery.json');
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

    const fileRepo = new FilePersistentMarketRepository(testFilePath);
    setMarketRepository(fileRepo);

    const saleRes = acceptCompletedSale({
      id: 'file-repo-sale-1',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '50',
      quantity: '1',
      eventTime: 1710000000000,
      status: 'completed',
    });
    expect(saleRes.accepted).toBe(true);
    await new Promise((res) => setTimeout(res, 100));

    const snap = serializeMarketState();
    await fileRepo.saveSnapshot(snap);
    await new Promise((res) => setTimeout(res, 100));

    clearMarketState(false);
    expect(allSales.length).toBe(0);

    const loadedSnap = fileRepo.loadSnapshot();
    expect(loadedSnap).not.toBeNull();
    restoreMarketState(loadedSnap!);

    expect(allSales.length).toBe(1);
    expect(allSales[0].id).toBe('file-repo-sale-1');

    fileRepo.clear();
    expect(fs.existsSync(testFilePath)).toBe(false);
  });

  test('Scenario 3: Late sale updating restored closed candles', () => {
    clearMarketState();
    const baseTime = 1710000000000;

    acceptCompletedSale({
      id: 'late-s1',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '100',
      quantity: '1',
      eventTime: baseTime,
      status: 'completed',
    });

    acceptCompletedSale({
      id: 'late-s2',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '110',
      quantity: '1',
      eventTime: baseTime + 60000,
      status: 'completed',
    });

    const snapshot = serializeMarketState();
    clearMarketState();

    restoreMarketState(snapshot);
    expect(closedCandles[instKey][tf1m].length).toBe(1);
    expect(closedCandles[instKey][tf1m][0].high).toBe('100');

    const lateRes = acceptCompletedSale({
      id: 'late-sale-high-price',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '200',
      quantity: '1',
      eventTime: baseTime + 30000,
      status: 'completed',
    });

    expect(lateRes.accepted).toBe(true);
    const updatedClosedCandle = closedCandles[instKey][tf1m][0];
    expect(updatedClosedCandle.high).toBe('200');
  });

  test('Scenario 4: Duplicate candle prevention & empty candle filtering', () => {
    clearMarketState();

    const badSnapshot: MarketSnapshot = {
      version: 1,
      timestamp: Date.now(),
      allSales: [
        {
          id: 'valid-s1',
          collectionId: 'durov-cap',
          price: '100',
          quantity: '1',
          currency: 'TON',
          eventTime: 1710000000000,
          status: 'completed',
        },
      ],
      processedSaleIds: ['valid-s1'],
      activeCandles: {
        [instKey]: {
          [tf1m]: {
            instrumentKey: instKey,
            timeframe: tf1m,
            startTime: 1710000000000,
            endTime: 1710000060000,
            open: '100',
            high: '100',
            low: '100',
            close: '100',
            volume: '1',
            quoteVolume: '100',
            tradeCount: 1,
            confirmed: false,
            revision: 1,
            updatedAt: 1710000000000,
          },
        },
      },
      closedCandles: {
        [instKey]: {
          [tf1m]: [
            {
              instrumentKey: instKey,
              timeframe: tf1m,
              startTime: 1710000000000,
              endTime: 1710000060000,
              open: '90',
              high: '95',
              low: '85',
              close: '95',
              volume: '1',
              quoteVolume: '90',
              tradeCount: 1,
              confirmed: true,
              revision: 1,
              updatedAt: 1710000000000,
            },
            {
              instrumentKey: instKey,
              timeframe: tf1m,
              startTime: 1710000000000,
              endTime: 1710000060000,
              open: '90',
              high: '100',
              low: '85',
              close: '100',
              volume: '2',
              quoteVolume: '190',
              tradeCount: 2,
              confirmed: true,
              revision: 2,
              updatedAt: 1710000010000,
            },
            {
              instrumentKey: instKey,
              timeframe: tf1m,
              startTime: 1710000060000,
              endTime: 1710000120000,
              open: '0',
              high: '0',
              low: '0',
              close: '0',
              volume: '0',
              quoteVolume: '0',
              tradeCount: 0,
              confirmed: true,
              revision: 0,
              updatedAt: 1710000060000,
            },
          ],
        },
      },
    };

    restoreMarketState(badSnapshot);

    const restoredClosed = closedCandles[instKey][tf1m];
    expect(restoredClosed.length).toBe(1);
    expect(restoredClosed[0].startTime).toBe(1710000000000);
  });

  test('Scenario 5: Mock sales isolation in production history', () => {
    clearMarketState();
    delete process.env.SIMULATION_MODE;

    const mockResProd = acceptCompletedSale({
      id: 'mock-sale-prod',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '100',
      quantity: '1',
      eventTime: 1710000000000,
      status: 'completed',
      isMock: true,
    });
    expect(mockResProd.accepted).toBe(false);

    process.env.SIMULATION_MODE = 'true';
    const mockResSim = acceptCompletedSale({
      id: 'mock-sale-sim',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '100',
      quantity: '1',
      eventTime: 1710000000000,
      status: 'completed',
      isMock: true,
    });
    expect(mockResSim.accepted).toBe(true);

    const snapshotWithMock = serializeMarketState(true);
    clearMarketState();

    delete process.env.SIMULATION_MODE;
    restoreMarketState(snapshotWithMock);
    expect(allSales.length).toBe(0);
  });
});
