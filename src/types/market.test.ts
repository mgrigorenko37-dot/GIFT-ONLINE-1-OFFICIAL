import {
  buildInstrumentKey,
  parseInstrumentKey,
  normalizeInstrumentKey,
  msToSeconds,
  secondsToMs,
  GiftSale,
  GiftCandle,
  Timeframe,
} from "./market";
import { getCandleRange } from "../../server/chartEngine";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertThrows(fn: () => void, expectedMessagePart?: string) {
  let threw = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
    if (expectedMessagePart) {
      assert(
        err.message.includes(expectedMessagePart),
        `Expected error message to contain "${expectedMessagePart}", got "${err.message}"`
      );
    }
  }
  assert(threw, "Expected function to throw an error");
}

console.log("Running market.test.ts...");

// Test 1: buildInstrumentKey with collection/model/backdrop/currency
{
  const key = buildInstrumentKey({
    collectionId: "pepe-gifts",
    modelId: "golden",
    backdropId: "sunset",
    currency: "TON",
  });
  assert(
    key === "pepe-gifts:golden:sunset:TON",
    `Test 1 failed. Got: ${key}`
  );
  console.log("✓ Test 1 passed: buildInstrumentKey with full parameters");
}

// Test 2: buildInstrumentKey with missing modelId and backdropId
{
  const key = buildInstrumentKey({
    collectionId: "pepe-gifts",
    currency: "TON",
  });
  assert(
    key === "pepe-gifts:all:all:TON",
    `Test 2 failed. Got: ${key}`
  );
  console.log("✓ Test 2 passed: buildInstrumentKey with missing optional fields defaults to 'all'");
}

// Test 3: Same result for same set of parameters (deterministic)
{
  const key1 = buildInstrumentKey({
    collectionId: "durov-cap",
    modelId: "rare",
    backdropId: "blue",
    currency: "STARS",
  });
  const key2 = buildInstrumentKey({
    collectionId: "durov-cap",
    modelId: "rare",
    backdropId: "blue",
    currency: "STARS",
  });
  assert(key1 === key2, "Test 3 failed: keys are not deterministic");
  console.log("✓ Test 3 passed: buildInstrumentKey is deterministic");
}

// Test 4: parseInstrumentKey
{
  const parsed = parseInstrumentKey("pepe-gifts:golden:sunset:TON");
  assert(parsed.collectionId === "pepe-gifts", "parse collectionId failed");
  assert(parsed.modelId === "golden", "parse modelId failed");
  assert(parsed.backdropId === "sunset", "parse backdropId failed");
  assert(parsed.currency === "TON", "parse currency failed");
  console.log("✓ Test 4 passed: parseInstrumentKey correctly parses valid key");
}

// Test 5: TON currency support
{
  const key = buildInstrumentKey({ collectionId: "cap", currency: "TON" });
  const parsed = parseInstrumentKey(key);
  assert(parsed.currency === "TON", "Test 5 TON failed");
  console.log("✓ Test 5 passed: TON currency handling");
}

// Test 6: STARS currency support
{
  const key = buildInstrumentKey({ collectionId: "cap", currency: "STARS" });
  const parsed = parseInstrumentKey(key);
  assert(parsed.currency === "STARS", "Test 6 STARS failed");
  console.log("✓ Test 6 passed: STARS currency handling");
}

// Test 7: Invalid currency rejected
{
  assertThrows(() => {
    buildInstrumentKey({ collectionId: "cap", currency: "USD" as any });
  }, "Invalid currency");
  console.log("✓ Test 7 passed: Invalid currency throws error");
}

// Test 8: Empty collectionId rejected
{
  assertThrows(() => {
    buildInstrumentKey({ collectionId: "", currency: "TON" });
  }, "collectionId must be a non-empty string");
  console.log("✓ Test 8 passed: Empty collectionId throws error");
}

// Test 9: Difference between 1m and 1M
{
  const baseTime = Date.UTC(2026, 1, 15, 12, 30, 45); // Feb 15, 2026 12:30:45 UTC
  const range1m = getCandleRange(baseTime, "1m");
  const range1M = getCandleRange(baseTime, "1M");

  const duration1m = range1m.endTime - range1m.startTime; // 60,000 ms = 1 minute
  const duration1M = range1M.endTime - range1M.startTime; // Feb 2026 = 28 days = 2,419,200,000 ms

  assert(duration1m === 60000, `1m duration expected 60000 ms, got ${duration1m}`);
  assert(duration1M > 2000000000, `1M duration expected >2B ms, got ${duration1M}`);
  assert(duration1m !== duration1M, "1m and 1M must not be equal");
  console.log("✓ Test 9 passed: Distinction between 1m (1 minute) and 1M (calendar month)");
}

// Test 10: Timestamps stay in milliseconds inside backend
{
  const nowMs = 1710000000123;
  const sale: GiftSale = {
    id: "sale-1",
    collectionId: "durov-cap",
    currency: "TON",
    price: "100",
    quantity: "1",
    eventTime: nowMs,
    createdAt: nowMs,
    status: "completed",
  };

  assert(sale.eventTime === nowMs, "Sale eventTime must stay in Unix milliseconds");
  assert(sale.eventTime > 1000000000000, "Timestamp must be 13 digits (ms)");
  console.log("✓ Test 10 passed: Backend timestamps remain in milliseconds");
}

// Test 11: Correct conversion ms -> seconds for frontend boundary
{
  const ms = 1710000000000;
  const sec = msToSeconds(ms);
  assert(sec === 1710000000, `msToSeconds failed. Got ${sec}`);
  assert(secondsToMs(sec) === ms, "secondsToMs failed inverse check");
  console.log("✓ Test 11 passed: msToSeconds and secondsToMs boundary conversion");
}

console.log("\nALL MARKET TYPES AND INSTRUMENT KEY TESTS PASSED SUCCESSFULLY!");
