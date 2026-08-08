import assert from 'node:assert';
import { CandleStore, SequenceTracker, SaleTracker } from '../src/lib/realtimeStream';
import { GiftCandle, GiftSale, Timeframe } from '../src/types/market';
import {
  handleSubscribe,
  handleUnsubscribe,
  handleDisconnect,
  clearAllSubscriptions,
  getSocketSubscriptions,
  broadcastSaleResult,
  resetSequence,
} from './realtimeManager';
import { clearMarketState, acceptCompletedSale } from './marketState';

const instA = 'durov-cap:all:all:TON';
const instB = 'pepe-hat:all:all:STARS';
const tf1m: Timeframe = '1m';
const tf1h: Timeframe = '1h';

function resetAll() {
  clearAllSubscriptions();
  clearMarketState();
  resetSequence(0);
}

function createMockSocket(id: string) {
  const emittedEvents: Array<{ event: string; payload: any }> = [];
  return {
    id,
    connected: true,
    join: (_room: string) => {},
    leave: (_room: string) => {},
    emit: (event: string, payload: any) => {
      emittedEvents.push({ event, payload });
    },
    emittedEvents,
    clearEmitted: () => {
      emittedEvents.length = 0;
    },
  };
}

console.log('=== Running Stage 13: Reliable Realtime Recovery After Reconnect Scenarios ===');

// 1. Complete reconnect scenario
resetAll();
{
  const candleStore = new CandleStore(instA, tf1m);
  const saleTracker = new SaleTracker(instA);
  const sequenceTracker = new SequenceTracker();

  // Seed server with initial REST sale
  acceptCompletedSale({
    id: 'sale-rest-0',
    collectionId: 'durov-cap',
    modelId: 'all',
    backdropId: 'all',
    currency: 'TON',
    price: '11',
    quantity: 1,
    eventTime: 1710000030000,
    status: 'completed',
  });

  const restCandles: GiftCandle[] = [
    {
      instrumentKey: instA,
      timeframe: tf1m,
      startTime: 1710000000000,
      endTime: 1710000060000,
      open: '10', high: '12', low: '9', close: '11',
      volume: '5', quoteVolume: '50', tradeCount: 3,
      confirmed: true, revision: 1, updatedAt: 1710000060000,
    },
  ];
  candleStore.mergeCandles(restCandles);
  assert.strictEqual(candleStore.getSortedCandles().length, 1);

  const mockSocket = createMockSocket('client-1');
  handleSubscribe(mockSocket, { instrumentKey: instA, timeframe: tf1m });

  const activeCandle1: GiftCandle = {
    instrumentKey: instA,
    timeframe: tf1m,
    startTime: 1710000060000,
    endTime: 1710000120000,
    open: '11', high: '13', low: '11', close: '12.5',
    volume: '2', quoteVolume: '24', tradeCount: 2,
    confirmed: false, revision: 1, updatedAt: 1710000080000,
  };
  sequenceTracker.processSequence(1);
  candleStore.applyCandle(activeCandle1);
  assert.strictEqual(candleStore.getSortedCandles().length, 2);

  // Disconnect
  handleDisconnect(mockSocket);
  mockSocket.connected = false;

  // Sales during disconnect
  acceptCompletedSale({
    id: 'sale-disc-1',
    collectionId: 'durov-cap',
    modelId: 'all',
    backdropId: 'all',
    currency: 'TON',
    price: '15',
    quantity: 1,
    eventTime: 1710000090000,
    status: 'completed',
  });

  acceptCompletedSale({
    id: 'sale-disc-2',
    collectionId: 'durov-cap',
    modelId: 'all',
    backdropId: 'all',
    currency: 'TON',
    price: '16',
    quantity: 1,
    eventTime: 1710000130000,
    status: 'completed',
  });

  // Reconnect
  mockSocket.connected = true;
  mockSocket.clearEmitted();
  handleSubscribe(mockSocket, { instrumentKey: instA, timeframe: tf1m });

  const snapshotEvent = mockSocket.emittedEvents.find((e) => e.event === 'market_event' && e.payload?.type === 'snapshot');
  assert.ok(snapshotEvent, 'Snapshot event should be emitted');

  const snapshotPayload = snapshotEvent.payload;
  assert.ok(snapshotPayload.sequence > 1, 'Snapshot sequence must increment');

  const seqRes = sequenceTracker.processSequence(snapshotPayload.sequence, true);
  assert.strictEqual(seqRes.ok, true);

  let tfCandles: GiftCandle[] = [];
  if (Array.isArray(snapshotPayload.timeframes)) {
    const tfData = snapshotPayload.timeframes.find((t: any) => t.timeframe === tf1m);
    if (tfData) tfCandles = tfData.candles || tfData.closedCandles || [];
  } else if (snapshotPayload.timeframes && typeof snapshotPayload.timeframes === 'object') {
    tfCandles = snapshotPayload.timeframes[tf1m] || [];
  }

  candleStore.mergeCandles(tfCandles);
  if (snapshotPayload.recentSales) saleTracker.mergeSales(snapshotPayload.recentSales);

  const allCandles = candleStore.getSortedCandles();
  assert.strictEqual(allCandles.length, 3, 'Candles merged without duplicates');
  assert.strictEqual(allCandles[0].startTime, 1710000000000);
  assert.strictEqual(allCandles[1].startTime, 1710000060000);
  assert.strictEqual(allCandles[2].startTime, 1710000120000);
  assert.strictEqual(saleTracker.getRecentSales().length, 3, 'Sales deduplicated cleanly');
  console.log('✓ Scenario 1 passed: Complete reconnect scenario without duplicates');
}

// 2. Reconnect during REST request isolates stale config token
resetAll();
{
  const oldConfigToken = {
    instrumentKey: instA,
    currency: 'TON' as const,
    timeframe: tf1m,
    requestId: 10,
    subscriptionId: 'sub_10_old',
  };

  const activeConfigToken = {
    instrumentKey: instA,
    currency: 'TON' as const,
    timeframe: tf1m,
    requestId: 11,
    subscriptionId: 'sub_11_new',
  };

  const candleStore = new CandleStore(instA, tf1m);

  const staleRestCandle: GiftCandle = {
    instrumentKey: instA,
    timeframe: tf1m,
    startTime: 1710000000000,
    endTime: 1710000060000,
    open: '10', high: '10', low: '10', close: '10',
    volume: '1', quoteVolume: '10', tradeCount: 1,
    confirmed: true, revision: 1, updatedAt: 1710000060000,
  };

  const mergeWithTokenValidation = (
    candles: GiftCandle[],
    token: typeof oldConfigToken,
    activeToken: typeof activeConfigToken
  ) => {
    if (token.requestId !== activeToken.requestId || token.subscriptionId !== activeToken.subscriptionId) {
      return 0;
    }
    return candleStore.mergeCandles(candles);
  };

  const rejectedCount = mergeWithTokenValidation([staleRestCandle], oldConfigToken, activeConfigToken);
  assert.strictEqual(rejectedCount, 0, 'Stale REST response rejected');
  assert.strictEqual(candleStore.getSortedCandles().length, 0);

  const acceptedCount = mergeWithTokenValidation([staleRestCandle], activeConfigToken, activeConfigToken);
  assert.strictEqual(acceptedCount, 1, 'Matching REST response accepted');
  assert.strictEqual(candleStore.getSortedCandles().length, 1);
  console.log('✓ Scenario 2 passed: Reconnect during REST request isolates stale config token');
}

// 3. Reconnect during timeframe switch
resetAll();
{
  const mockSocket = createMockSocket('client-switch');

  handleUnsubscribe(mockSocket, { instrumentKey: instA, timeframe: tf1m });
  handleSubscribe(mockSocket, { instrumentKey: instA, timeframe: tf1h });

  const store1h = new CandleStore(instA, tf1h);

  const candle1m: GiftCandle = {
    instrumentKey: instA,
    timeframe: tf1m,
    startTime: 1710000000000,
    endTime: 1710000060000,
    open: '10', high: '12', low: '9', close: '11',
    volume: '5', quoteVolume: '50', tradeCount: 3,
    confirmed: true, revision: 1, updatedAt: 1710000060000,
  };

  const candle1h: GiftCandle = {
    instrumentKey: instA,
    timeframe: tf1h,
    startTime: 1710000000000,
    endTime: 1710003600000,
    open: '10', high: '20', low: '8', close: '18',
    volume: '100', quoteVolume: '1500', tradeCount: 50,
    confirmed: false, revision: 1, updatedAt: 1710000100000,
  };

  assert.strictEqual(store1h.applyCandle(candle1m).updated, false, '1m candle rejected by 1h store');
  assert.strictEqual(store1h.applyCandle(candle1h).updated, true, '1h candle accepted by 1h store');
  assert.strictEqual(store1h.getSortedCandles().length, 1);
  assert.strictEqual(store1h.getSortedCandles()[0].timeframe, '1h');
  console.log('✓ Scenario 3 passed: Reconnect during timeframe switch strictly isolates timeframes');
}

// 4. Sequence gap detection & recovery
resetAll();
{
  const sequenceTracker = new SequenceTracker();

  assert.strictEqual(sequenceTracker.processSequence(10).ok, true);

  const gapRes = sequenceTracker.processSequence(15);
  assert.strictEqual(gapRes.ok, false);
  assert.strictEqual(gapRes.gap, true);
  assert.strictEqual(gapRes.reason, 'sequence_gap');

  const snapRes = sequenceTracker.processSequence(16, true);
  assert.strictEqual(snapRes.ok, true);
  assert.strictEqual(snapRes.gap, false);
  assert.strictEqual(sequenceTracker.getLastSequence(), 16);

  assert.strictEqual(sequenceTracker.processSequence(17).ok, true);
  console.log('✓ Scenario 4 passed: Sequence gap triggers resync & snapshot restores sync');
}

// 5. Duplicate snapshot merge idempotency
resetAll();
{
  const candleStore = new CandleStore(instA, tf1m);
  const saleTracker = new SaleTracker(instA);

  const candle: GiftCandle = {
    instrumentKey: instA,
    timeframe: tf1m,
    startTime: 1710000000000,
    endTime: 1710000060000,
    open: '10', high: '12', low: '9', close: '11',
    volume: '5', quoteVolume: '50', tradeCount: 3,
    confirmed: true, revision: 1, updatedAt: 1710000060000,
  };

  const sale: GiftSale = {
    id: 'sale-dup-snap',
    collectionId: 'durov-cap',
    modelId: 'all',
    backdropId: 'all',
    currency: 'TON',
    price: '11',
    quantity: 1,
    eventTime: 1710000050000,
    timestamp: 1710000050000,
    status: 'completed',
    instrumentKey: instA,
  };

  candleStore.mergeCandles([candle]);
  saleTracker.mergeSales([sale]);

  assert.strictEqual(candleStore.getSortedCandles().length, 1);
  assert.strictEqual(saleTracker.getRecentSales().length, 1);

  // Duplicate merge
  candleStore.mergeCandles([candle]);
  saleTracker.mergeSales([sale]);

  assert.strictEqual(candleStore.getSortedCandles().length, 1, 'Duplicate snapshot candle ignored');
  assert.strictEqual(saleTracker.getRecentSales().length, 1, 'Duplicate snapshot sale ignored');
  console.log('✓ Scenario 5 passed: Duplicate snapshot merge is idempotent');
}

// 6. Stale revision rejected
resetAll();
{
  const candleStore = new CandleStore(instA, tf1m);

  const rev2Candle: GiftCandle = {
    instrumentKey: instA,
    timeframe: tf1m,
    startTime: 1710000000000,
    endTime: 1710000060000,
    open: '10', high: '15', low: '9', close: '14',
    volume: '10', quoteVolume: '120', tradeCount: 5,
    confirmed: false, revision: 2, updatedAt: 1710000030000,
  };

  const rev1StaleCandle: GiftCandle = {
    instrumentKey: instA,
    timeframe: tf1m,
    startTime: 1710000000000,
    endTime: 1710000060000,
    open: '10', high: '10', low: '10', close: '10',
    volume: '1', quoteVolume: '10', tradeCount: 1,
    confirmed: false, revision: 1, updatedAt: 1710000010000,
  };

  candleStore.applyCandle(rev2Candle);
  assert.strictEqual(candleStore.getSortedCandles()[0].revision, 2);

  const applyStale = candleStore.applyCandle(rev1StaleCandle);
  assert.strictEqual(applyStale.updated, false, 'Stale revision rejected');
  assert.strictEqual(candleStore.getSortedCandles()[0].revision, 2);
  assert.strictEqual(candleStore.getSortedCandles()[0].close, '14');
  console.log('✓ Scenario 6 passed: Stale revision rejected and newer revision preserved');
}

// 7. Late sale recalculation
resetAll();
{
  acceptCompletedSale({
    id: 'sale-normal-1',
    collectionId: 'durov-cap',
    modelId: 'all',
    backdropId: 'all',
    currency: 'TON',
    price: '10',
    quantity: 1,
    eventTime: 1710000030000,
    status: 'completed',
  });

  const candleStore = new CandleStore(instA, tf1m);

  const lateResult = acceptCompletedSale({
    id: 'sale-late-1',
    collectionId: 'durov-cap',
    modelId: 'all',
    backdropId: 'all',
    currency: 'TON',
    price: '8',
    quantity: 1,
    eventTime: 1710000010000,
    status: 'completed',
  });

  assert.strictEqual(lateResult.accepted, true);
  assert.ok(lateResult.candleEvents);

  const ce = lateResult.candleEvents.find((e) => e.timeframe === tf1m);
  assert.ok(ce);
  assert.strictEqual(ce.candle.revision, 2);

  const applyRes = candleStore.applyCandle(ce.candle);
  assert.strictEqual(applyRes.updated, true);

  const candles = candleStore.getSortedCandles();
  assert.strictEqual(candles.length, 1, 'In-place update without duplicate candle');
  assert.strictEqual(candles[0].low, '8');
  assert.strictEqual(candles[0].open, '8');
  assert.strictEqual(candles[0].revision, 2);
  console.log('✓ Scenario 7 passed: Late sale recalculates candle and updates in-place without duplicate');
}

// 8. Duplicate subscription
resetAll();
{
  const mockSocket = createMockSocket('client-resub');

  const res1 = handleSubscribe(mockSocket, { instrumentKey: instA, timeframe: tf1m });
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.isDuplicate, false);

  mockSocket.clearEmitted();

  const res2 = handleSubscribe(mockSocket, { instrumentKey: instA, timeframe: tf1m });
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.isDuplicate, true);

  const snapEvent = mockSocket.emittedEvents.find((e) => e.event === 'market_event' && e.payload?.type === 'snapshot');
  assert.ok(snapEvent, 'Snapshot re-emitted for duplicate sub');

  const activeSubs = getSocketSubscriptions(mockSocket.id);
  assert.strictEqual(activeSubs.length, 1, 'Single active subscription maintained');
  console.log('✓ Scenario 8 passed: Duplicate subscription handles recovery without stream duplication');
}

// 9. Multiple clients
resetAll();
{
  const clientA = createMockSocket('client-A');
  const clientB = createMockSocket('client-B');

  handleSubscribe(clientA, { instrumentKey: instA, timeframe: tf1m });
  handleSubscribe(clientB, { instrumentKey: instB, timeframe: tf1m });

  clientA.clearEmitted();
  clientB.clearEmitted();

  const saleAResult = acceptCompletedSale({
    id: 'sale-A-1',
    collectionId: 'durov-cap',
    modelId: 'all',
    backdropId: 'all',
    currency: 'TON',
    price: '20',
    quantity: 1,
    eventTime: 1710000010000,
    status: 'completed',
  });

  broadcastSaleResult(saleAResult);

  const eventA = clientA.emittedEvents.find((e) => e.event === 'market_event' && e.payload?.instrumentKey === instA);
  assert.ok(eventA, 'Client A received event for Instrument A');

  const eventBForA = clientB.emittedEvents.find((e) => e.event === 'market_event' && e.payload?.instrumentKey === instA);
  assert.strictEqual(eventBForA, undefined, 'Client B received NO event for Instrument A');

  clientA.clearEmitted();
  clientB.clearEmitted();

  const saleBResult = acceptCompletedSale({
    id: 'sale-B-1',
    collectionId: 'pepe-hat',
    modelId: 'all',
    backdropId: 'all',
    currency: 'STARS',
    price: '100',
    quantity: 1,
    eventTime: 1710000020000,
    status: 'completed',
  });

  broadcastSaleResult(saleBResult);

  const eventB = clientB.emittedEvents.find((e) => e.event === 'market_event' && e.payload?.instrumentKey === instB);
  assert.ok(eventB, 'Client B received event for Instrument B');

  const eventAForB = clientA.emittedEvents.find((e) => e.event === 'market_event' && e.payload?.instrumentKey === instB);
  assert.strictEqual(eventAForB, undefined, 'Client A received NO event for Instrument B');
  console.log('✓ Scenario 9 passed: Multiple clients strictly isolated by subscription');
}

console.log('ALL STAGE 13 REALTIME RECONNECT RECOVERY TESTS PASSED SUCCESSFULLY!');
