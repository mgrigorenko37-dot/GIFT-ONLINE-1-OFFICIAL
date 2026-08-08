import assert from 'assert';
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
  getMarketRepository
} from './marketState';
import {
  InMemoryMarketRepository,
  FilePersistentMarketRepository,
  MarketSnapshot
} from './marketRepository';
import path from 'path';
import fs from 'fs';

console.log('=== Running Stage 15: Reliable Market Data Recovery Scenarios ===');

const instKey = 'durov-cap:all:all:TON';
const tf1m = '1m';
const tf1h = '1h';

// Ensure simulation mode is off initially
delete process.env.SIMULATION_MODE;

// Scenario 1: Basic Save -> Clear Memory -> Restore -> New Sale -> Duplicate Sale
{
  clearMarketState();
  const baseTime = 1710000000000;

  // 1. Accept initial sales across 2 minutes
  const sale1Res = acceptCompletedSale({
    id: 'rec-sale-1',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '100',
    quantity: '1',
    eventTime: baseTime,
    status: 'completed'
  });
  assert.strictEqual(sale1Res.accepted, true);

  const sale2Res = acceptCompletedSale({
    id: 'rec-sale-2',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '110',
    quantity: '2',
    eventTime: baseTime + 10000,
    status: 'completed'
  });
  assert.strictEqual(sale2Res.accepted, true);

  // Close first candle by pushing sale in minute 2
  const sale3Res = acceptCompletedSale({
    id: 'rec-sale-3',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '120',
    quantity: '1',
    eventTime: baseTime + 60000,
    status: 'completed'
  });
  assert.strictEqual(sale3Res.accepted, true);

  // Check pre-restore state
  assert.strictEqual(allSales.length, 3);
  assert.strictEqual(processedSaleIds.size, 3);
  assert.strictEqual(closedCandles[instKey][tf1m].length, 1);
  assert.ok(activeCandles[instKey][tf1m]);

  const preSnapshot = serializeMarketState();
  assert.strictEqual(preSnapshot.allSales.length, 3);

  // 4. Clear memory
  clearMarketState();
  assert.strictEqual(allSales.length, 0);
  assert.strictEqual(processedSaleIds.size, 0);
  assert.strictEqual(Object.keys(activeCandles).length, 0);
  assert.strictEqual(Object.keys(closedCandles).length, 0);

  // 5. Restore state
  const restoreRes = restoreMarketState(preSnapshot);
  assert.strictEqual(restoreRes.success, true);
  assert.strictEqual(restoreRes.restoredSalesCount, 3);

  assert.strictEqual(allSales.length, 3);
  assert.strictEqual(processedSaleIds.size, 3);
  assert.strictEqual(closedCandles[instKey][tf1m].length, 1);
  assert.strictEqual(closedCandles[instKey][tf1m][0].close, '110');
  assert.strictEqual(activeCandles[instKey][tf1m].open, '120');

  // 6. Accept a new sale on restored market
  const sale4Res = acceptCompletedSale({
    id: 'rec-sale-4',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '130',
    quantity: '1',
    eventTime: baseTime + 70000,
    status: 'completed'
  });
  assert.strictEqual(sale4Res.accepted, true);

  // 7. Verify OHLCV and revision on active candle
  const activeCandle = activeCandles[instKey][tf1m];
  assert.strictEqual(activeCandle.open, '120');
  assert.strictEqual(activeCandle.high, '130');
  assert.strictEqual(activeCandle.close, '130');
  assert.strictEqual(activeCandle.tradeCount, 2);
  assert.strictEqual(activeCandle.revision, 2);

  // 8. Re-submit old pre-restore sale
  const dupRes = acceptCompletedSale({
    id: 'rec-sale-1',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '100',
    quantity: '1',
    eventTime: baseTime,
    status: 'completed'
  });

  // 9. Verify duplicate rejected and market unchanged
  assert.strictEqual(dupRes.accepted, false);
  assert.strictEqual(dupRes.reason, 'duplicate');
  assert.strictEqual(allSales.length, 4);

  console.log('✓ Scenario 1 passed: State serialization, memory wipe, restoration, new sale processing & duplicate rejection');
}

// Scenario 2: FilePersistentMarketRepository End-to-End Test
{
  clearMarketState();
  const testFilePath = path.join(process.cwd(), '.test_market_recovery.json');
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

  const fileRepo = new FilePersistentMarketRepository(testFilePath);
  setMarketRepository(fileRepo);

  // Ingest sale
  const saleRes = acceptCompletedSale({
    id: 'file-repo-sale-1',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '50',
    quantity: '1',
    eventTime: 1710000000000,
    status: 'completed'
  });
  assert.strictEqual(saleRes.accepted, true);

  const snap = serializeMarketState();
  fileRepo.saveSnapshot(snap);

  clearMarketState();
  assert.strictEqual(allSales.length, 0);

  const loadedSnap = fileRepo.loadSnapshot();
  assert.ok(loadedSnap !== null);
  restoreMarketState(loadedSnap);

  assert.strictEqual(allSales.length, 1);
  assert.strictEqual(allSales[0].id, 'file-repo-sale-1');

  // Cleanup test file
  fileRepo.clear();
  assert.strictEqual(fs.existsSync(testFilePath), false);

  console.log('✓ Scenario 2 passed: FilePersistentMarketRepository save/load and state recovery verified');
}

// Scenario 3: Late sale updating restored closed candles
{
  clearMarketState();
  const baseTime = 1710000000000;

  // Sale in minute 0
  acceptCompletedSale({
    id: 'late-s1',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '100',
    quantity: '1',
    eventTime: baseTime,
    status: 'completed'
  });

  // Sale in minute 1 (closes minute 0 candle)
  acceptCompletedSale({
    id: 'late-s2',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '110',
    quantity: '1',
    eventTime: baseTime + 60000,
    status: 'completed'
  });

  const snapshot = serializeMarketState();
  clearMarketState();

  // Restore state
  restoreMarketState(snapshot);
  assert.strictEqual(closedCandles[instKey][tf1m].length, 1);
  assert.strictEqual(closedCandles[instKey][tf1m][0].high, '100');

  // Submit late sale belonging to restored closed candle in minute 0 with higher price
  const lateRes = acceptCompletedSale({
    id: 'late-sale-high-price',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '200',
    quantity: '1',
    eventTime: baseTime + 30000,
    status: 'completed'
  });

  assert.strictEqual(lateRes.accepted, true);
  const updatedClosedCandle = closedCandles[instKey][tf1m][0];
  assert.strictEqual(updatedClosedCandle.high, '200');
  assert.strictEqual(updatedClosedCandle.tradeCount, 2);
  assert.strictEqual(updatedClosedCandle.revision, 2);

  console.log('✓ Scenario 3 passed: Late sale correctly updates restored historical closed candle');
}

// Scenario 4: Duplicate candle prevention & empty candle filtering
{
  clearMarketState();

  // Create a corrupt/duplicate snapshot manually
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
        status: 'completed'
      }
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
          updatedAt: 1710000000000
        }
      }
    },
    closedCandles: {
      [instKey]: {
        [tf1m]: [
          // Duplicate 1
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
            updatedAt: 1710000000000
          },
          // Duplicate 2 (same startTime)
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
            updatedAt: 1710000010000
          },
          // Empty candle with 0 trades
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
            updatedAt: 1710000060000
          }
        ]
      }
    }
  };

  restoreMarketState(badSnapshot);

  // Verify deduplicated closed candles
  const restoredClosed = closedCandles[instKey][tf1m];
  assert.strictEqual(restoredClosed.length, 1, 'Duplicate and empty candles filtered out');
  assert.strictEqual(restoredClosed[0].startTime, 1710000000000);

  console.log('✓ Scenario 4 passed: Duplicate candles & empty candles strictly eliminated during state restoration');
}

// Scenario 5: Mock sales isolation in production history
{
  clearMarketState();
  delete process.env.SIMULATION_MODE;

  // Attempt mock sale without simulation mode -> Rejected
  const mockResProd = acceptCompletedSale({
    id: 'mock-sale-prod',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '100',
    quantity: '1',
    eventTime: 1710000000000,
    status: 'completed',
    isMock: true
  });
  assert.strictEqual(mockResProd.accepted, false);
  assert.strictEqual(mockResProd.reason, 'invalid');

  // Turn on simulation mode -> Accepted
  process.env.SIMULATION_MODE = 'true';
  const mockResSim = acceptCompletedSale({
    id: 'mock-sale-sim',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '100',
    quantity: '1',
    eventTime: 1710000000000,
    status: 'completed',
    isMock: true
  });
  assert.strictEqual(mockResSim.accepted, true);

  const snapshotWithMock = serializeMarketState(true);
  clearMarketState();

  // Turn off simulation mode and restore snapshot -> Mock sale excluded
  delete process.env.SIMULATION_MODE;
  restoreMarketState(snapshotWithMock);
  assert.strictEqual(allSales.length, 0, 'Mock sale excluded from production history when SIMULATION_MODE is off');

  console.log('✓ Scenario 5 passed: Mock sales strictly isolated from production history');
}

console.log('ALL STAGE 15 MARKET RECOVERY TESTS PASSED SUCCESSFULLY!');
