import { describe, it, expect } from "vitest";
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

describe("Market Types and Instrument Key Tests", () => {
  it("builds instrument key with full parameters", () => {
    const key = buildInstrumentKey({
      collectionId: "pepe-gifts",
      modelId: "golden",
      backdropId: "sunset",
      currency: "TON",
    });
    expect(key).toBe("pepe-gifts:golden:sunset:TON");
  });

  it("builds instrument key with missing optional fields defaulting to 'all'", () => {
    const key = buildInstrumentKey({
      collectionId: "pepe-gifts",
      currency: "TON",
    });
    expect(key).toBe("pepe-gifts:all:all:TON");
  });

  it("is deterministic for same parameters", () => {
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
    expect(key1).toBe(key2);
  });

  it("parses valid instrument key", () => {
    const parsed = parseInstrumentKey("pepe-gifts:golden:sunset:TON");
    expect(parsed.collectionId).toBe("pepe-gifts");
    expect(parsed.modelId).toBe("golden");
    expect(parsed.backdropId).toBe("sunset");
    expect(parsed.currency).toBe("TON");
  });

  it("handles TON and STARS currency", () => {
    const keyTON = buildInstrumentKey({ collectionId: "cap", currency: "TON" });
    expect(parseInstrumentKey(keyTON).currency).toBe("TON");

    const keySTARS = buildInstrumentKey({ collectionId: "cap", currency: "STARS" });
    expect(parseInstrumentKey(keySTARS).currency).toBe("STARS");
  });

  it("throws error for invalid currency or empty collectionId", () => {
    expect(() => buildInstrumentKey({ collectionId: "cap", currency: "USD" as any })).toThrow(/Invalid currency/);
    expect(() => buildInstrumentKey({ collectionId: "", currency: "TON" })).toThrow(/collectionId must be a non-empty string/);
  });

  it("distinguishes between 1m and 1M timeframes", () => {
    const baseTime = Date.UTC(2026, 1, 15, 12, 30, 45);
    const range1m = getCandleRange(baseTime, "1m");
    const range1M = getCandleRange(baseTime, "1M");

    const duration1m = range1m.endTime - range1m.startTime;
    const duration1M = range1M.endTime - range1M.startTime;

    expect(duration1m).toBe(60000);
    expect(duration1M).toBeGreaterThan(2000000000);
    expect(duration1m).not.toBe(duration1M);
  });

  it("keeps timestamps in milliseconds inside backend and converts at boundary", () => {
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

    expect(sale.eventTime).toBe(nowMs);
    const sec = msToSeconds(nowMs);
    expect(sec).toBe(Math.floor(nowMs / 1000));
    expect(secondsToMs(sec)).toBe(sec * 1000);
  });
});
