import assert from 'assert';
import {
  clearMarketState,
  acceptCompletedSale,
  getMarketCandlesHistory,
  allSales,
  processedSaleIds,
  activeCandles,
  closedCandles,
  serializeMarketState,
  restoreMarketState
} from './marketState';
import {
  handleSubscribe,
  handleUnsubscribe,
  handleDisconnect,
  clearAllSubscriptions,
  getSocketSubscriptions
} from './realtimeManager';
import {
  addListing,
  getFloorPrice,
  clearFloorState
} from './floorManager';
import {
  getMarketStats
} from './marketStats';
import {
  getIndicators
} from './indicatorEngine';
import {
  CandleStore,
  SaleTracker,
  SequenceTracker
} from '../src/lib/realtimeStream';
import {
  Timeframe,
  GiftSale,
  GiftCandle,
  buildInstrumentKey,
  parseInstrumentKey,
  VALID_TIMEFRAMES,
  secondsToMs,
  msToSeconds
} from '../src/types/market';

console.log('=== Running Stage 16: Complete End-to-End User Scenario & Integration Verification ===');

// Reset state
clearMarketState();
clearAllSubscriptions();

// Timeframes to test
const timeframes: Timeframe[] = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
const currencies = ['TON', 'STARS'] as const;

// 1. Canonical instrumentKey construction & parsing test across combinations
{
  const testCases = [
    { opts: { collectionId: 'durov-cap', modelId: 'all', backdropId: 'all', currency: 'TON' as const }, expected: 'durov-cap:all:all:TON' },
    { opts: { collectionId: 'pepe-hat', modelId: 'gold', backdropId: 'space', currency: 'STARS' as const }, expected: 'pepe-hat:gold:space:STARS' },
    { opts: { collectionId: 'plush-bear', modelId: 'rare', backdropId: 'all', currency: 'TON' as const }, expected: 'plush-bear:rare:all:TON' }
  ];

  for (const tc of testCases) {
    const key = buildInstrumentKey(tc.opts);
    assert.strictEqual(key, tc.expected, `Canonical key built correctly for ${tc.opts.collectionId}`);
    const parsed = parseInstrumentKey(key);
    assert.strictEqual(parsed.collectionId, tc.opts.collectionId);
    assert.strictEqual(parsed.modelId, tc.opts.modelId);
    assert.strictEqual(parsed.backdropId, tc.opts.backdropId);
    assert.strictEqual(parsed.currency, tc.opts.currency);
  }
  console.log('✓ Steps 1-3 passed: Canonical instrumentKey generation & parameter parsing verified for TON and STARS');
}

// 2. Comprehensive E2E flow across ALL 9 timeframes
{
  for (const tf of timeframes) {
    clearMarketState();
    clearFloorState();
    clearAllSubscriptions();

    const collection = 'durov-cap';
    const curr = 'TON';
    const instKey = buildInstrumentKey({ collectionId: collection, currency: curr });
    const baseTime = 1710000000000;

    // Step 5-7: REST History on empty market
    const emptyHist = getMarketCandlesHistory(instKey, tf);
    assert.strictEqual(emptyHist.candles.length, 0, `Empty history returns 0 candles for timeframe ${tf}`);

    // Step 10-11: Socket.io Subscription
    const receivedEvents: any[] = [];
    const mockSocket = {
      id: `socket_e2e_${tf}`,
      join: () => {},
      leave: () => {},
      emit: (event: string, payload: any) => {
        receivedEvents.push({ event, payload });
      }
    };

    const subRes = handleSubscribe(mockSocket, { instrumentKey: instKey, timeframe: tf });
    assert.strictEqual(subRes.success, true);

    // Step 14-17: Single Sale Ingestion & Single Dispatch
    const sale1Time = baseTime + 1000;
    const sale1: GiftSale = {
      id: `sale-${tf}-1`,
      collectionId: collection,
      price: '100',
      quantity: 1,
      currency: curr,
      eventTime: sale1Time,
      status: 'completed'
    };

    const ingestRes1 = acceptCompletedSale(sale1);
    assert.strictEqual(ingestRes1.accepted, true);
    assert.strictEqual(ingestRes1.reason, 'accepted');

    // Verify snapshot + sale + candle_update events emitted
    const saleEvents1 = receivedEvents.filter(e => e.event === 'market_event');
    assert.strictEqual(saleEvents1.length, 3, '1 snapshot + 1 sale + 1 candle_update event emitted');

    // Step 8: Frontend timestamp conversion check
    const activeC = activeCandles[instKey][tf];
    assert.ok(activeC, `Active candle created for timeframe ${tf}`);
    const secStart = msToSeconds(activeC.startTime);
    const msStart = secondsToMs(secStart);
    assert.strictEqual(msStart, activeC.startTime, 'Millisecond <-> second round-trip lossfree');

    // Step 12: Second sale in same candle updates active candle in-place
    const sale2Time = baseTime + 1200;
    const sale2: GiftSale = {
      id: `sale-${tf}-2`,
      collectionId: collection,
      price: '150',
      quantity: 1,
      currency: curr,
      eventTime: sale2Time,
      status: 'completed'
    };

    acceptCompletedSale(sale2);
    const updatedActiveC = activeCandles[instKey][tf];
    assert.strictEqual(updatedActiveC.high, '150');
    assert.strictEqual(updatedActiveC.tradeCount, 2);

    // Step 18: Floor price update separately
    addListing({
      id: `listing-${tf}`,
      instrumentKey: instKey,
      price: '95',
      currency: curr,
      status: 'active'
    });
    const floorState = getFloorPrice(instKey);
    assert.strictEqual(floorState?.floorPrice, '95');
    assert.strictEqual(floorState?.listedCount, 1);

    // Step 24: Duplicate sale ignored
    const dupRes = acceptCompletedSale(sale1);
    assert.strictEqual(dupRes.accepted, false);
    assert.strictEqual(dupRes.reason, 'duplicate');

    // Cleanup
    handleDisconnect(mockSocket);
  }

  console.log('✓ Steps 4-18, 24 passed: Verified ingestion, OHLCV, Socket.io, floor price & duplicate handling across ALL 9 timeframes');
}

// 3. Timeframe Switching & Stream Isolation Test (Steps 19-20)
{
  clearMarketState();
  clearAllSubscriptions();

  const instKey = 'durov-cap:all:all:TON';
  const receivedTfEvents: string[] = [];

  const socket = {
    id: 'socket_switch_tf',
    join: () => {},
    leave: () => {},
    emit: (event: string, payload: any) => {
      if (event === 'market_event' && payload.candle) {
        receivedTfEvents.push(payload.timeframe);
      }
    }
  };

  // Subscribe to 1m
  handleSubscribe(socket, { instrumentKey: instKey, timeframe: '1m' });

  // Switch to 1h
  handleUnsubscribe(socket, { instrumentKey: instKey, timeframe: '1m' });
  handleSubscribe(socket, { instrumentKey: instKey, timeframe: '1h' });

  // Clear initial snapshot logs
  receivedTfEvents.length = 0;

  // Emit sale
  acceptCompletedSale({
    id: 'sale-switch-1',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '200',
    quantity: 1,
    eventTime: 1710000000000,
    status: 'completed'
  });

  assert.ok(receivedTfEvents.includes('1h'), 'Received 1h event');
  assert.strictEqual(receivedTfEvents.includes('1m'), false, 'Did NOT receive unsubscribed 1m event');

  handleDisconnect(socket);
  console.log('✓ Steps 19-20 passed: Timeframe switching strictly unsubscribes previous timeframe stream');
}

// 4. Reconnect Recovery, Late Sale Correction & Revision Display (Steps 21-23)
{
  clearMarketState();
  clearAllSubscriptions();

  const instKey = 'durov-cap:all:all:TON';
  const baseTime = 1710000000000;

  // Initial sales
  acceptCompletedSale({
    id: 's-recon-1',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '100',
    quantity: 1,
    eventTime: baseTime,
    status: 'completed'
  });

  // Close candle 1
  acceptCompletedSale({
    id: 's-recon-2',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '100',
    quantity: 1,
    eventTime: baseTime + 60000,
    status: 'completed'
  });

  const snapshot = serializeMarketState();
  clearMarketState();

  // Simulate server restart / reconnect state restoration
  restoreMarketState(snapshot);

  const closed = closedCandles[instKey]['1m'];
  assert.strictEqual(closed.length, 1);
  assert.strictEqual(closed[0].high, '100');
  assert.strictEqual(closed[0].revision, 1);

  // Step 22: Late sale correcting closed historical candle
  const lateRes = acceptCompletedSale({
    id: 's-late-recon',
    collectionId: 'durov-cap',
    currency: 'TON',
    price: '300', // Higher price in closed candle
    quantity: 1,
    eventTime: baseTime + 30000,
    status: 'completed'
  });

  assert.strictEqual(lateRes.accepted, true);

  // Step 23: Verify high updated and revision incremented to 2
  const updatedClosed = closedCandles[instKey]['1m'][0];
  assert.strictEqual(updatedClosed.high, '300');
  assert.strictEqual(updatedClosed.tradeCount, 2);
  assert.strictEqual(updatedClosed.revision, 2);

  console.log('✓ Steps 21-23 passed: Reconnect state recovery, late sale correction & revision incrementing verified');
}

console.log('ALL STAGE 16 END-TO-END SCENARIO & INTEGRATION TESTS PASSED SUCCESSFULLY!');
