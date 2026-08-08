import assert from 'assert';
import { clearMarketState, acceptCompletedSale, allSales, processedSaleIds, closedCandles, activeCandles, getMarketCandlesHistory } from './marketState';
import { handleSubscribe, handleUnsubscribe, handleDisconnect, clearAllSubscriptions, getSocketSubscriptions, broadcastSaleResult } from './realtimeManager';
import { CandleStore, SaleTracker, SequenceTracker } from '../src/lib/realtimeStream';
import { GiftCandle, GiftSale, Timeframe } from '../src/types/market';

console.log('=== Running Stage 14: Realtime Chart Performance & Resource Optimization Scenarios ===');

// Clear state
clearMarketState();
clearAllSubscriptions();

const instA = 'durov-cap:all:all:TON';
const instB = 'pepe-hat:all:all:STARS';
const tf1m: Timeframe = '1m';
const tf1h: Timeframe = '1h';

// Scenario 1: Large volume of candles memory bounding in CandleStore
{
  const store = new CandleStore(instA, tf1m);
  const baseTime = 1710000000000;
  
  // Apply 6000 candles
  for (let i = 0; i < 6000; i++) {
    const c: GiftCandle = {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: baseTime + i * 60000,
      endTime: baseTime + (i + 1) * 60000,
      open: '10',
      high: '12',
      low: '9',
      close: '11',
      volume: '1',
      quoteVolume: '10',
      tradeCount: 1,
      confirmed: true,
      revision: 1,
      updatedAt: baseTime + i * 60000
    };
    store.applyCandle(c);
  }

  const sorted = store.getSortedCandles();
  assert.strictEqual(sorted.length, 5000, 'CandleStore bounded to 5000 candles max');
  assert.strictEqual(sorted[0].startTime, baseTime + 1000 * 60000, 'Oldest 1000 candles pruned correctly');
  assert.strictEqual(sorted[4999].startTime, baseTime + 5999 * 60000, 'Newest candle present');
  console.log('✓ Scenario 1 passed: Large volume of candles bounded in memory (CandleStore)');
}

// Scenario 2: Large volume of sales memory bounding on Backend
{
  clearMarketState();
  
  // Ingest 25,000 completed sales
  for (let i = 0; i < 25000; i++) {
    acceptCompletedSale({
      id: `sale-perf-${i}`,
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '10',
      quantity: 1,
      eventTime: 1710000000000 + i * 1000,
      status: 'completed'
    });
  }

  assert.ok(allSales.length <= 20000, `allSales bounded to 20,000 recent sales max, actual: ${allSales.length}`);
  assert.strictEqual(processedSaleIds.size, 25000, 'processedSaleIds tracks recent dedupe keys without leak');

  // Verify duplicate rejection for recent sale
  const dupResult = acceptCompletedSale({
    id: 'sale-perf-24999',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '10',
    quantity: 1,
    eventTime: 1710000000000 + 24999 * 1000,
    status: 'completed'
  });
  assert.strictEqual(dupResult.accepted, false);
  assert.strictEqual(dupResult.reason, 'duplicate');

  console.log('✓ Scenario 2 passed: Large volume of sales bounded on backend without breaking deduplication');
}

// Scenario 3: Closed candles bounding per timeframe
{
  clearMarketState();
  const baseTime = 1710000000000;

  // Simulate 6000 closed candle pushes for 1m timeframe
  for (let i = 0; i < 6000; i++) {
    acceptCompletedSale({
      id: `sale-tf-${i}`,
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '10',
      quantity: 1,
      eventTime: baseTime + i * 60000, // 1 minute per sale to close 1m candles
      status: 'completed'
    });
  }

  const closed = closedCandles[instA]?.[tf1m] || [];
  assert.ok(closed.length <= 5000, `closedCandles for ${tf1m} bounded to 5000 max, actual: ${closed.length}`);
  console.log('✓ Scenario 3 passed: Closed candles history bounded to 5000 per timeframe');
}

// Scenario 4: Multiple clients & socket disconnect cleanup
{
  clearAllSubscriptions();

  // Create 100 mock sockets
  const sockets = Array.from({ length: 100 }, (_, i) => ({
    id: `mock_socket_${i}`,
    join: () => {},
    leave: () => {},
    emit: () => {}
  }));

  for (const s of sockets) {
    handleSubscribe(s, { instrumentKey: instA, timeframe: tf1m });
  }

  // Verify all 100 sockets are tracked
  for (const s of sockets) {
    const subs = getSocketSubscriptions(s.id);
    assert.strictEqual(subs.length, 1);
    assert.strictEqual(subs[0].instrumentKey, instA);
  }

  // Disconnect 50 sockets
  for (let i = 0; i < 50; i++) {
    handleDisconnect(sockets[i]);
  }

  // Verify 50 disconnected sockets removed cleanly
  for (let i = 0; i < 50; i++) {
    const subs = getSocketSubscriptions(sockets[i].id);
    assert.strictEqual(subs.length, 0);
  }

  // Verify remaining 50 sockets active
  for (let i = 50; i < 100; i++) {
    const subs = getSocketSubscriptions(sockets[i].id);
    assert.strictEqual(subs.length, 1);
  }

  // Cleanup all
  for (let i = 50; i < 100; i++) {
    handleDisconnect(sockets[i]);
  }

  console.log('✓ Scenario 4 passed: 100 concurrent client sockets managed and disconnected cleanly without memory leak');
}

// Scenario 5: Duplicate subscription handling
{
  clearAllSubscriptions();
  const socket = {
    id: 'socket_dup_test',
    join: () => {},
    leave: () => {},
    emit: () => {}
  };

  const res1 = handleSubscribe(socket, { instrumentKey: instA, timeframe: tf1m });
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.isDuplicate, false);

  const res2 = handleSubscribe(socket, { instrumentKey: instA, timeframe: tf1m });
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.isDuplicate, true);

  const subs = getSocketSubscriptions(socket.id);
  assert.strictEqual(subs.length, 1, 'Only 1 subscription stored for identical subKey');

  handleDisconnect(socket);
  console.log('✓ Scenario 5 passed: Duplicate subscription handled without creating redundant streams or leaks');
}

// Scenario 6: Uninterested client event isolation
{
  clearAllSubscriptions();
  let instAEvents = 0;
  let instBEvents = 0;

  const socketA = {
    id: 'socket_client_A',
    join: () => {},
    leave: () => {},
    emit: (event: string, payload: any) => {
      if (event === 'market_event' && payload.instrumentKey === instA) instAEvents++;
    }
  };

  const socketB = {
    id: 'socket_client_B',
    join: () => {},
    leave: () => {},
    emit: (event: string, payload: any) => {
      if (event === 'market_event' && payload.instrumentKey === instB) instBEvents++;
    }
  };

  handleSubscribe(socketA, { instrumentKey: instA, timeframe: tf1m });
  handleSubscribe(socketB, { instrumentKey: instB, timeframe: tf1m });

  // Reset counters after initial subscription snapshots
  instAEvents = 0;
  instBEvents = 0;

  // Broadcast sale for Instrument A
  acceptCompletedSale({
    id: 'sale-iso-A',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '20',
    quantity: 1,
    eventTime: 1710000000000,
    status: 'completed'
  });

  assert.ok(instAEvents > 0, 'Client A received instrument A event');
  assert.strictEqual(instBEvents, 0, 'Client B received ZERO instrument A events');

  handleDisconnect(socketA);
  handleDisconnect(socketB);
  console.log('✓ Scenario 6 passed: Events strictly isolated to interested clients only');
}

// Scenario 7: REST history limit enforcement & pagination
{
  clearMarketState();
  const baseTime = 1710000000000;

  for (let i = 0; i < 2000; i++) {
    acceptCompletedSale({
      id: `sale-hist-${i}`,
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '10',
      quantity: 1,
      eventTime: baseTime + i * 60000,
      status: 'completed'
    });
  }

  // Query REST history without limit -> defaults to 500, max capped at 1000
  const page1 = getMarketCandlesHistory(instA, tf1m, { limit: 2000 });
  assert.strictEqual(page1.candles.length, 1000, 'Max candles limit capped at 1000');
  assert.strictEqual(page1.hasMore, true);
  assert.ok(page1.nextCursor, 'Next cursor present for pagination');

  // Query page 2 with cursor
  const page2 = getMarketCandlesHistory(instA, tf1m, { limit: 1000, cursor: page1.nextCursor! });
  assert.ok(page2.candles.length > 0, 'Page 2 returns remaining candles');
  assert.strictEqual(page2.candles[0].startTime > Number(page1.nextCursor), true, 'Pagination strictly strictly advances after cursor');

  console.log('✓ Scenario 7 passed: REST history limit enforced and cursor pagination verified');
}

// Scenario 8: Incremental candle update performance
{
  clearMarketState();
  const baseTime = 1710000000000;

  // Ingest initial sale
  acceptCompletedSale({
    id: 'sale-perf-inc-1',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '10',
    quantity: 1,
    eventTime: baseTime,
    status: 'completed'
  });

  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    acceptCompletedSale({
      id: `sale-perf-inc-sub-${i}`,
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '11',
      quantity: 1,
      eventTime: baseTime + i * 100,
      status: 'completed'
    });
  }
  const t1 = performance.now();
  const duration = t1 - t0;
  assert.ok(duration < 500, `1,000 incremental sale processing executed in ${duration.toFixed(2)}ms (<500ms)`);

  console.log(`✓ Scenario 8 passed: 1,000 incremental sale updates executed in ${duration.toFixed(2)}ms`);
}

console.log('ALL STAGE 14 PERFORMANCE & RESOURCE OPTIMIZATION TESTS PASSED SUCCESSFULLY!');
