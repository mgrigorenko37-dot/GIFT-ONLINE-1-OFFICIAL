import { acceptCompletedSale, clearMarketState, allSales, getHistory } from './marketState';
import { GiftSale, GiftCandle, getAveragePrice, parsePositiveDecimal } from './chartEngine';
import Decimal from 'decimal.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

console.log("=== Running Stage 4: 27 Financial Precision & OHLCV Scenarios ===");

// ----------------------------------------------------
// Test 1: 0.1 + 0.2 gives exact 0.3
// ----------------------------------------------------
{
  const a = new Decimal("0.1");
  const b = new Decimal("0.2");
  const sum = a.plus(b).toString();
  assert(sum === "0.3", `Test 1: Expected "0.3", got "${sum}"`);
  console.log("✓ Test 1 passed: 0.1 + 0.2 = 0.3 exact Decimal result");
}

// ----------------------------------------------------
// Test 2: 0.1 * 3 gives exact 0.3
// ----------------------------------------------------
{
  const a = new Decimal("0.1");
  const prod = a.mul("3").toString();
  assert(prod === "0.3", `Test 2: Expected "0.3", got "${prod}"`);
  console.log("✓ Test 2 passed: 0.1 * 3 = 0.3 exact Decimal result");
}

// ----------------------------------------------------
// Test 3: Sale with price = 0.1, quantity = 3
// ----------------------------------------------------
{
  clearMarketState();
  const sale = { id: "p1", collectionId: "c1", price: "0.1", quantity: "3", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const res = acceptCompletedSale(sale);
  assert(res.accepted, "Test 3: Sale accepted");
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.volume === "3", `Test 3: Volume expected "3", got "${candle.volume}"`);
  assert(candle.quoteVolume === "0.3", `Test 3: QuoteVolume expected "0.3", got "${candle.quoteVolume}"`);
  console.log("✓ Test 3 passed: price=0.1 * quantity=3 gives exact volume=3, quoteVolume=0.3");
}

// ----------------------------------------------------
// Test 4: Two sales with prices 0.1 and 0.2
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "0.1", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const s2 = { id: "s2", collectionId: "c1", price: "0.2", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res2 = acceptCompletedSale(s2);
  const candle = res2.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.quoteVolume === "0.3", `Test 4: QuoteVolume expected "0.3", got "${candle.quoteVolume}"`);
  assert(candle.high === "0.2", `Test 4: High expected "0.2", got "${candle.high}"`);
  assert(candle.low === "0.1", `Test 4: Low expected "0.1", got "${candle.low}"`);
  console.log("✓ Test 4 passed: Two sales 0.1 and 0.2 sum to quoteVolume=0.3 with correct high/low");
}

// ----------------------------------------------------
// Test 5: Weighted average price
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const s2 = { id: "s2", collectionId: "c1", price: "20", quantity: "3", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res2 = acceptCompletedSale(s2);
  const candle = res2.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.sumQuantity === "4", `Test 5: sumQuantity expected "4", got "${candle.sumQuantity}"`);
  assert(candle.sumQuote === "70", `Test 5: sumQuote expected "70", got "${candle.sumQuote}"`);
  const avg = getAveragePrice(candle);
  assert(avg === "17.5", `Test 5: Weighted average price expected "17.5", got "${avg}"`);
  console.log("✓ Test 5 passed: Weighted average price calculated as 70/4 = 17.5");
}

// ----------------------------------------------------
// Test 6: Large number of decimal places
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "0.000000001", quantity: "1000000000.999999999", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const res = acceptCompletedSale(s1);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.quoteVolume === "1.000000000999999999", `Test 6: High precision quoteVolume expected "1.000000000999999999", got "${candle.quoteVolume}"`);
  console.log("✓ Test 6 passed: High precision decimal places handled without loss");
}

// ----------------------------------------------------
// Test 7: Very large price value
// ----------------------------------------------------
{
  clearMarketState();
  const largePrice = "1000000000000000";
  const s1 = { id: "s1", collectionId: "c1", price: largePrice, quantity: "2", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const res = acceptCompletedSale(s1);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.quoteVolume === "2000000000000000", `Test 7: Large price quoteVolume expected "2000000000000000", got "${candle.quoteVolume}"`);
  console.log("✓ Test 7 passed: Very large price handled accurately");
}

// ----------------------------------------------------
// Test 8: Very large quantity value
// ----------------------------------------------------
{
  clearMarketState();
  const largeQty = "5000000000000000";
  const s1 = { id: "s1", collectionId: "c1", price: "2", quantity: largeQty, currency: "TON", eventTime: 1710000000000, status: "completed" };
  const res = acceptCompletedSale(s1);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.volume === largeQty, `Test 8: Volume expected "${largeQty}", got "${candle.volume}"`);
  assert(candle.quoteVolume === "10000000000000000", `Test 8: QuoteVolume expected "10000000000000000", got "${candle.quoteVolume}"`);
  console.log("✓ Test 8 passed: Very large quantity handled accurately");
}

// ----------------------------------------------------
// Test 9: High with precise decimal comparisons
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "0.3", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const s2 = { id: "s2", collectionId: "c1", price: "0.3000000001", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res2 = acceptCompletedSale(s2);
  const candle = res2.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.high === "0.3000000001", `Test 9: High expected "0.3000000001", got "${candle.high}"`);
  console.log("✓ Test 9 passed: High comparison exact with Decimal");
}

// ----------------------------------------------------
// Test 10: Low with precise decimal comparisons
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "0.3", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const s2 = { id: "s2", collectionId: "c1", price: "0.2999999999", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res2 = acceptCompletedSale(s2);
  const candle = res2.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.low === "0.2999999999", `Test 10: Low expected "0.2999999999", got "${candle.low}"`);
  console.log("✓ Test 10 passed: Low comparison exact with Decimal");
}

// ----------------------------------------------------
// Test 11: Sales in reverse chronological order
// ----------------------------------------------------
{
  clearMarketState();
  const sLater = { id: "sLater", collectionId: "c1", price: "120", quantity: "1", currency: "TON", eventTime: 1710000030000, status: "completed" };
  const sEarlier = { id: "sEarlier", collectionId: "c1", price: "80", quantity: "1", currency: "TON", eventTime: 1710000010000, status: "completed" };
  
  acceptCompletedSale(sLater);
  const res = acceptCompletedSale(sEarlier);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.open === "80", `Test 11: Open expected "80", got "${candle.open}"`);
  assert(candle.close === "120", `Test 11: Close expected "120", got "${candle.close}"`);
  console.log("✓ Test 11 passed: Reverse delivery correctly assigns open=80, close=120");
}

// ----------------------------------------------------
// Test 12: Two sales with identical eventTime tie-breaker by id
// ----------------------------------------------------
{
  clearMarketState();
  const sameTs = 1710000010000;
  const sB = { id: "sale-b", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: sameTs, status: "completed" };
  const sA = { id: "sale-a", collectionId: "c1", price: "90", quantity: "1", currency: "TON", eventTime: sameTs, status: "completed" };
  
  acceptCompletedSale(sB);
  const res = acceptCompletedSale(sA);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.open === "90", `Test 12: Tie-breaker open expected "90" (sale-a < sale-b), got "${candle.open}"`);
  assert(candle.close === "100", `Test 12: Tie-breaker close expected "100" (sale-b > sale-a), got "${candle.close}"`);
  console.log("✓ Test 12 passed: Identical timestamp tie-breaker via sale.id is deterministic");
}

// ----------------------------------------------------
// Test 13: Late sale changes open
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000020000, status: "completed" };
  const sLateOpen = { id: "sLateOpen", collectionId: "c1", price: "70", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res = acceptCompletedSale(sLateOpen);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.open === "70", `Test 13: Open expected "70", got "${candle.open}"`);
  console.log("✓ Test 13 passed: Late sale with earlier eventTime changes open");
}

// ----------------------------------------------------
// Test 14: Late sale changes close
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000010000, status: "completed" };
  const sLateClose = { id: "sLateClose", collectionId: "c1", price: "150", quantity: "1", currency: "TON", eventTime: 1710000050000, status: "completed" };
  acceptCompletedSale(s1);
  const res = acceptCompletedSale(sLateClose);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.close === "150", `Test 14: Close expected "150", got "${candle.close}"`);
  console.log("✓ Test 14 passed: Late sale with later eventTime changes close");
}

// ----------------------------------------------------
// Test 15: Late sale changes high
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000010000, status: "completed" };
  const sLateHigh = { id: "sLateHigh", collectionId: "c1", price: "250", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res = acceptCompletedSale(sLateHigh);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.high === "250", `Test 15: High expected "250", got "${candle.high}"`);
  console.log("✓ Test 15 passed: Late sale with higher price changes high");
}

// ----------------------------------------------------
// Test 16: Late sale changes low
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000010000, status: "completed" };
  const sLateLow = { id: "sLateLow", collectionId: "c1", price: "40", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res = acceptCompletedSale(sLateLow);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.low === "40", `Test 16: Low expected "40", got "${candle.low}"`);
  console.log("✓ Test 16 passed: Late sale with lower price changes low");
}

// ----------------------------------------------------
// Test 17: Late sale changes volume
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "2", currency: "TON", eventTime: 1710000010000, status: "completed" };
  const sLateVol = { id: "sLateVol", collectionId: "c1", price: "100", quantity: "3", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res = acceptCompletedSale(sLateVol);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.volume === "5", `Test 17: Volume expected "5", got "${candle.volume}"`);
  console.log("✓ Test 17 passed: Late sale increases volume accurately");
}

// ----------------------------------------------------
// Test 18: Late sale changes quoteVolume
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000010000, status: "completed" };
  const sLateQuote = { id: "sLateQuote", collectionId: "c1", price: "50", quantity: "2", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res = acceptCompletedSale(sLateQuote);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  assert(candle.quoteVolume === "200", `Test 18: QuoteVolume expected "200", got "${candle.quoteVolume}"`);
  console.log("✓ Test 18 passed: Late sale increases quoteVolume accurately");
}

// ----------------------------------------------------
// Test 19: Duplicate sale does NOT change candle
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000010000, status: "completed" };
  const res1 = acceptCompletedSale(s1);
  const candle1 = res1.candles?.find(c => c.timeframe === "1m")!;
  const rev1 = candle1.revision;

  const resDup = acceptCompletedSale(s1);
  assert(resDup.accepted === false, "Test 19: Duplicate rejected");
  assert(resDup.candles === undefined, "Test 19: Duplicate returns no candles");
  
  const history = getHistory("c1:all:all:TON", "1m", 0, 2000000000000);
  assert(history[0].revision === rev1, "Test 19: Revision unchanged on duplicate");
  assert(history[0].tradeCount === 1, "Test 19: TradeCount unchanged on duplicate");
  console.log("✓ Test 19 passed: Duplicate sale does not change candle or increment revision");
}

// ----------------------------------------------------
// Test 20: Pending sale does NOT change candle
// ----------------------------------------------------
{
  clearMarketState();
  const pending = { id: "p1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000010000, status: "pending" };
  const res = acceptCompletedSale(pending);
  assert(res.accepted === false, "Test 20: Pending sale rejected");
  const history = getHistory("c1:all:all:TON", "1m", 0, 2000000000000);
  assert(history.length === 0, "Test 20: History empty");
  console.log("✓ Test 20 passed: Pending sale rejected, no candles created");
}

// ----------------------------------------------------
// Test 21: TON and STARS calculated separately
// ----------------------------------------------------
{
  clearMarketState();
  const sTon = { id: "sTon", collectionId: "c1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const sStars = { id: "sStars", collectionId: "c1", price: "500", quantity: "1", currency: "STARS", eventTime: 1710000000000, status: "completed" };
  acceptCompletedSale(sTon);
  acceptCompletedSale(sStars);

  const tonHist = getHistory("c1:all:all:TON", "1m", 0, 2000000000000);
  const starsHist = getHistory("c1:all:all:STARS", "1m", 0, 2000000000000);

  assert(tonHist[0].close === "10", "Test 21: TON close = 10");
  assert(starsHist[0].close === "500", "Test 21: STARS close = 500");
  console.log("✓ Test 21 passed: TON and STARS strictly isolated");
}

// ----------------------------------------------------
// Test 22: Different modelId calculated separately
// ----------------------------------------------------
{
  clearMarketState();
  const sModel1 = { id: "sM1", collectionId: "c1", modelId: "m1", price: "10", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const sModel2 = { id: "sM2", collectionId: "c1", modelId: "m2", price: "20", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  acceptCompletedSale(sModel1);
  acceptCompletedSale(sModel2);

  const m1Hist = getHistory("c1:m1:all:TON", "1m", 0, 2000000000000);
  const m2Hist = getHistory("c1:m2:all:TON", "1m", 0, 2000000000000);

  assert(m1Hist[0].close === "10", "Test 22: Model 1 close = 10");
  assert(m2Hist[0].close === "20", "Test 22: Model 2 close = 20");
  console.log("✓ Test 22 passed: Different modelIds strictly isolated");
}

// ----------------------------------------------------
// Test 23: Different backdropId calculated separately
// ----------------------------------------------------
{
  clearMarketState();
  const sB1 = { id: "sB1", collectionId: "c1", backdropId: "b1", price: "15", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const sB2 = { id: "sB2", collectionId: "c1", backdropId: "b2", price: "25", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  acceptCompletedSale(sB1);
  acceptCompletedSale(sB2);

  const b1Hist = getHistory("c1:all:b1:TON", "1m", 0, 2000000000000);
  const b2Hist = getHistory("c1:all:b2:TON", "1m", 0, 2000000000000);

  assert(b1Hist[0].close === "15", "Test 23: Backdrop 1 close = 15");
  assert(b2Hist[0].close === "25", "Test 23: Backdrop 2 close = 25");
  console.log("✓ Test 23 passed: Different backdropIds strictly isolated");
}

// ----------------------------------------------------
// Test 24: All 9 timeframes updated on sale
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const res = acceptCompletedSale(s1);
  assert(res.candles !== undefined && res.candles.length === 9, "Test 24: Updated exactly 9 timeframes");
  const timeframes = res.candles?.map(c => c.timeframe).sort();
  const expectedTfs = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"].sort();
  assert(JSON.stringify(timeframes) === JSON.stringify(expectedTfs), "Test 24: All 9 valid timeframes present");
  console.log("✓ Test 24 passed: Single sale updates all 9 timeframes");
}

// ----------------------------------------------------
// Test 25: API/Socket serialization has no floating-point artifacts
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "0.1", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const s2 = { id: "s2", collectionId: "c1", price: "0.2", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  acceptCompletedSale(s1);
  const res2 = acceptCompletedSale(s2);
  const candle = res2.candles?.find(c => c.timeframe === "1m")!;
  const jsonStr = JSON.stringify(candle);
  assert(!jsonStr.includes("0.30000000000000004"), "Test 25: No float artifact string");
  assert(candle.quoteVolume === "0.3", "Test 25: Clean quoteVolume 0.3");
  console.log("✓ Test 25 passed: Serialization free of floating-point artifacts");
}

// ----------------------------------------------------
// Test 26: API/Socket serialization has no NaN or Infinity
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const res = acceptCompletedSale(s1);
  const candle = res.candles?.find(c => c.timeframe === "1m")!;
  const jsonStr = JSON.stringify(candle);
  assert(!jsonStr.includes("NaN"), "Test 26: No NaN in serialization");
  assert(!jsonStr.includes("Infinity"), "Test 26: No Infinity in serialization");
  console.log("✓ Test 26 passed: Serialization contains no NaN or Infinity");
}

// ----------------------------------------------------
// Test 27: Revision increments only on real changes
// ----------------------------------------------------
{
  clearMarketState();
  const s1 = { id: "s1", collectionId: "c1", price: "100", quantity: "1", currency: "TON", eventTime: 1710000000000, status: "completed" };
  const s2 = { id: "s2", collectionId: "c1", price: "105", quantity: "1", currency: "TON", eventTime: 1710000005000, status: "completed" };
  
  const res1 = acceptCompletedSale(s1);
  const rev1 = res1.candles?.find(c => c.timeframe === "1m")!.revision;
  assert(rev1 === 1, `Test 27: First revision expected 1, got ${rev1}`);

  const res2 = acceptCompletedSale(s2);
  const rev2 = res2.candles?.find(c => c.timeframe === "1m")!.revision;
  assert(rev2 === 2, `Test 27: Second revision expected 2, got ${rev2}`);

  const resDup = acceptCompletedSale(s2);
  assert(!resDup.accepted, "Test 27: Dup rejected");
  const candleAfterDup = getHistory("c1:all:all:TON", "1m", 0, 2000000000000)[0];
  assert(candleAfterDup.revision === 2, `Test 27: Revision remains 2 after duplicate, got ${candleAfterDup.revision}`);
  console.log("✓ Test 27 passed: Revision increments strictly on real market changes");
}

console.log("\nALL 27 STAGE 4 FINANCIAL PRECISION & OHLCV TESTS PASSED SUCCESSFULLY!");
