import { acceptCompletedSale, clearMarketState, allSales, processedSaleIds, getHistory } from './marketState';
import { GiftSale } from './chartEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("=== Running Stage 3: Complete 25 Sales Ingestion, Validation & Deduplication Scenarios ===");

// ----------------------------------------------------
// Test 1: New completed sale accepted
// ----------------------------------------------------
{
  clearMarketState();
  const sale: GiftSale = {
    id: "sale-001",
    collectionId: "durov-cap",
    price: "100",
    quantity: "1",
    currency: "TON",
    eventTime: 1710000000000,
    createdAt: 1710000000000,
    status: "completed"
  };

  const res = acceptCompletedSale(sale);
  assert(res.accepted === true, "Test 1: Completed sale must be accepted");
  assert(res.reason === "accepted", "Test 1: Reason must be 'accepted'");
  assert(res.candles !== undefined && res.candles.length === 9, "Test 1: Must update 9 timeframes");
  assert(allSales.length === 1, "Test 1: allSales length must be 1");
  console.log("✓ Test 1 passed: New completed sale accepted");
}

// ----------------------------------------------------
// Test 2 & 3: Repeat sale identified as duplicate and duplicate doesn't trigger repeat aggregation
// ----------------------------------------------------
{
  clearMarketState();
  const sale: GiftSale = {
    id: "sale-002",
    collectionId: "durov-cap",
    price: "100",
    quantity: "1",
    currency: "TON",
    eventTime: 1710000000000,
    createdAt: 1710000000000,
    status: "completed"
  };

  const first = acceptCompletedSale(sale);
  assert(first.accepted === true, "Test 2: First delivery accepted");

  const duplicate = acceptCompletedSale(sale);
  assert(duplicate.accepted === false, "Test 2: Repeat sale must be rejected");
  assert(duplicate.reason === "duplicate", "Test 2: Reason must be 'duplicate'");
  assert(allSales.length === 1, "Test 3: allSales must not duplicate");

  const history = getHistory("durov-cap:all:all:TON", "1m", 0, 2000000000000);
  assert(history[0].tradeCount === 1, "Test 3: tradeCount must remain 1");
  assert(history[0].volume === "1", "Test 3: volume must remain 1");

  console.log("✓ Test 2 & 3 passed: Duplicate sale rejected without repeat aggregation");
}

// ----------------------------------------------------
// Test 4, 5, 6, 7: Pending, Cancelled, Reverted, Unknown status rejected
// ----------------------------------------------------
{
  clearMarketState();
  const pending = { id: "p1", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "pending" };
  const cancelled = { id: "c1", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "cancelled" };
  const reverted = { id: "r1", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "reverted" };
  const unknown = { id: "u1", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "foo" };

  assert(acceptCompletedSale(pending).reason === "not_completed", "Test 4: pending rejected");
  assert(acceptCompletedSale(cancelled).reason === "not_completed", "Test 5: cancelled rejected");
  assert(acceptCompletedSale(reverted).reason === "not_completed", "Test 6: reverted rejected");
  assert(acceptCompletedSale(unknown).reason === "not_completed", "Test 7: unknown status rejected");
  assert(allSales.length === 0, "Non-completed sales must not enter allSales");

  console.log("✓ Test 4, 5, 6, 7 passed: Non-completed statuses rejected");
}

// ----------------------------------------------------
// Test 8: Sale without id rejected OR uses composite fallback (transactionHash + giftId + eventTime)
// ----------------------------------------------------
{
  clearMarketState();
  const noIdNoFallback = { collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const withFallback = { transactionHash: "0xabc", giftId: "gift-99", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };

  assert(acceptCompletedSale(noIdNoFallback).accepted === false, "Test 8a: No ID and no fallback rejected");
  
  const fallbackRes = acceptCompletedSale(withFallback);
  assert(fallbackRes.accepted === true, "Test 8b: Valid composite fallback accepted");
  assert(fallbackRes.dedupeKey === "0xabc_gift-99_1710000000000", "Test 8b: Correct composite dedupe key");

  console.log("✓ Test 8 passed: Missing ID without fallback rejected; composite fallback accepted");
}

// ----------------------------------------------------
// Test 9: Two distinct sales with same timestamp accepted separately
// ----------------------------------------------------
{
  clearMarketState();
  const ts = 1710000000000;
  const saleA = { id: "sale-ts-a", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: ts, status: "completed" };
  const saleB = { id: "sale-ts-b", collectionId: "c1", price: "20", quantity: "1", currency: "TON", eventTime: ts, status: "completed" };

  assert(acceptCompletedSale(saleA).accepted === true, "Test 9a: Sale A accepted");
  assert(acceptCompletedSale(saleB).accepted === true, "Test 9b: Sale B accepted");
  assert(allSales.length === 2, "Test 9: Both sales stored");

  const history = getHistory("c1:all:all:TON", "1m", 0, 2000000000000);
  assert(history[0].tradeCount === 2, "Test 9: Candle tradeCount is 2");

  console.log("✓ Test 9 passed: Same timestamp distinct sales accepted separately");
}

// ----------------------------------------------------
// Test 10 & 11: Late sale & Reverse order sales accepted
// ----------------------------------------------------
{
  clearMarketState();
  const saleFuture = { id: "s-fut", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000120000, status: "completed" }; // 12:02
  const salePast   = { id: "s-past", collectionId: "c1", price: "50", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" }; // 12:00

  assert(acceptCompletedSale(saleFuture).accepted === true, "Test 10: Future sale accepted first");
  assert(acceptCompletedSale(salePast).accepted === true, "Test 11: Past/late sale accepted second");

  const history = getHistory("c1:all:all:TON", "1m", 0, 2000000000000);
  assert(history.length === 2, "Test 10/11: Both time buckets represented in history");
  assert(history[0].close === "50", "Test 10/11: Past candle updated with late sale");

  console.log("✓ Test 10 & 11 passed: Out-of-order/late sales accepted and update candles");
}

// ----------------------------------------------------
// Test 12, 13, 14, 15: Instrument Isolation (Collection, Model, Backdrop, Currency)
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", modelId: "m1", backdropId: "b1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const s2 = { id: "s2", collectionId: "c2", modelId: "m1", backdropId: "b1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" }; // diff collection
  const s3 = { id: "s3", collectionId: "c1", modelId: "m2", backdropId: "b1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" }; // diff model
  const s4 = { id: "s4", collectionId: "c1", modelId: "m1", backdropId: "b2", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" }; // diff backdrop
  const s5 = { id: "s5", collectionId: "c1", modelId: "m1", backdropId: "b1", price: "500", quantity: "1", currency: "STARS", eventTime: 1710000000000, status: "completed" }; // diff currency

  acceptCompletedSale(s1);
  acceptCompletedSale(s2);
  acceptCompletedSale(s3);
  acceptCompletedSale(s4);
  acceptCompletedSale(s5);

  assert(getHistory("c1:m1:b1:TON", "1m", 0, 2000000000000).length === 1, "Isolation c1:m1:b1:TON");
  assert(getHistory("c2:m1:b1:TON", "1m", 0, 2000000000000).length === 1, "Isolation c2:m1:b1:TON");
  assert(getHistory("c1:m2:b1:TON", "1m", 0, 2000000000000).length === 1, "Isolation c1:m2:b1:TON");
  assert(getHistory("c1:m1:b2:TON", "1m", 0, 2000000000000).length === 1, "Isolation c1:m1:b2:TON");
  assert(getHistory("c1:m1:b1:STARS", "1m", 0, 2000000000000)[0].close === "500", "Isolation STARS price");

  console.log("✓ Test 12, 13, 14, 15 passed: Strict isolation across collection, model, backdrop, currency");
}

// ----------------------------------------------------
// Test 16, 17: Zero price and Negative price rejected
// ----------------------------------------------------
{
  clearMarketState();
  const zeroPrice = { id: "zp", collectionId: "c1", price: "0", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const negPrice  = { id: "np", collectionId: "c1", price: "-10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };

  assert(acceptCompletedSale(zeroPrice).reason === "invalid", "Test 16: Zero price rejected");
  assert(acceptCompletedSale(negPrice).reason === "invalid", "Test 17: Negative price rejected");

  console.log("✓ Test 16 & 17 passed: Zero and negative prices rejected");
}

// ----------------------------------------------------
// Test 18, 19: Zero quantity and Negative quantity rejected
// ----------------------------------------------------
{
  clearMarketState();
  const zeroQty = { id: "zq", collectionId: "c1", price: "10", quantity: "0", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const negQty  = { id: "nq", collectionId: "c1", price: "10", quantity: "-1", currency: "TON", eventTime: 1710000000000, status: "completed" };

  assert(acceptCompletedSale(zeroQty).reason === "invalid", "Test 18: Zero quantity rejected");
  assert(acceptCompletedSale(negQty).reason === "invalid", "Test 19: Negative quantity rejected");

  console.log("✓ Test 18 & 19 passed: Zero and negative quantities rejected");
}

// ----------------------------------------------------
// Test 20: NaN and Infinity rejected
// ----------------------------------------------------
{
  clearMarketState();
  const nanPrice = { id: "nanP", collectionId: "c1", price: "abc", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const infPrice = { id: "infP", collectionId: "c1", price: Infinity, quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const nanTime  = { id: "nanT", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: NaN, status: "completed" };

  assert(acceptCompletedSale(nanPrice).reason === "invalid", "Test 20: NaN price rejected");
  assert(acceptCompletedSale(infPrice).reason === "invalid", "Test 20: Infinity price rejected");
  assert(acceptCompletedSale(nanTime).reason === "invalid", "Test 20: NaN time rejected");

  console.log("✓ Test 20 passed: NaN and Infinity values rejected");
}

// ----------------------------------------------------
// Test 21 & 22: Redelivery after reconnect & Single accepted sale triggers single change
// ----------------------------------------------------
{
  clearMarketState();
  const sale = { id: "reconn", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };

  const res1 = acceptCompletedSale(sale);
  assert(res1.accepted === true, "Test 21/22: First delivery accepted");
  assert(res1.candles !== undefined, "Test 21/22: Candles returned on first delivery");

  const res2 = acceptCompletedSale(sale);
  assert(res2.accepted === false, "Test 21/22: Reconnect delivery rejected as duplicate");
  assert(res2.candles === undefined, "Test 21/22: No candles generated on duplicate delivery");

  console.log("✓ Test 21 & 22 passed: Single market change on accepted sale, no changes on redelivery");
}

// ----------------------------------------------------
// Test 23: Mock sale uses common pipeline
// ----------------------------------------------------
{
  clearMarketState();
  const mockSale = {
    id: "mock-101",
    collectionId: "durov-cap",
    price: "124.50",
    quantity: "1",
    currency: "TON",
    eventTime: Date.now(),
    createdAt: Date.now(),
    status: "completed"
  };

  const res = acceptCompletedSale(mockSale);
  assert(res.accepted === true, "Test 23: Mock sale accepted via common pipeline");
  assert(allSales[0].id === "mock-101", "Test 23: Mock sale present in allSales");

  console.log("✓ Test 23 passed: Mock sales go through common acceptCompletedSale pipeline");
}

// ----------------------------------------------------
// Test 24: Timestamp in seconds rejected
// ----------------------------------------------------
{
  clearMarketState();
  const secondsSale = { id: "sec1", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000, status: "completed" };

  assert(acceptCompletedSale(secondsSale).reason === "invalid", "Test 24: Timestamp in seconds rejected");

  console.log("✓ Test 24 passed: Timestamp in seconds rejected");
}

// ----------------------------------------------------
// Test 25: Timestamp = 0 handled according to contract
// ----------------------------------------------------
{
  clearMarketState();
  const epochSale = { id: "epoch0", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 0, status: "completed" };

  const res = acceptCompletedSale(epochSale);
  assert(res.accepted === true, "Test 25: Timestamp = 0 (Unix epoch) accepted");
  assert(res.sale?.eventTime === 0, "Test 25: eventTime preserved as 0");

  console.log("✓ Test 25 passed: Timestamp = 0 supported correctly according to contract");
}

console.log("\nALL 25 STAGE 3 SALES INGESTION, VALIDATION & DEDUPLICATION TESTS PASSED SUCCESSFULLY!");

