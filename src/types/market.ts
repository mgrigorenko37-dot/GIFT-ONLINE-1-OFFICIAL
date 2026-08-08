/**
 * Unified Market Data Types and Instrument Key Utilities
 */

export type Currency = "TON" | "STARS";

export type Timeframe =
  | "1s"
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d"
  | "1w"
  | "1M";

export type SaleStatus = "completed" | "pending" | "reverted" | "cancelled";

export type ListingStatus = "active" | "sold" | "cancelled" | "expired";

export const VALID_TIMEFRAMES: Timeframe[] = [
  "1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"
];

export interface GiftSale {
  id: string;
  collectionId: string;
  instrumentKey?: string;
  giftId?: string;
  modelId?: string;
  backdropId?: string;
  symbol?: string;
  source?: string;
  price: string;
  currency: Currency;
  quantity: string | number;
  eventTime: number; // Unix timestamp in milliseconds
  createdAt?: number; // Unix timestamp in milliseconds
  timestamp?: number;
  sellerId?: string;
  buyerId?: string;
  transactionHash?: string;
  status: SaleStatus;
  isMock?: boolean;
}

export interface GiftCandle {
  instrumentKey: string;
  timeframe: Timeframe;
  startTime: number; // Unix timestamp in milliseconds
  endTime: number;   // Unix timestamp in milliseconds
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  tradeCount: number;
  itemCount?: string;
  sumQuote?: string;
  sumQuantity?: string;
  firstSaleId?: string;
  firstSaleTime?: number;
  lastSaleId?: string;
  lastSaleTime?: number;
  confirmed: boolean;
  revision: number;
  updatedAt: number; // Unix timestamp in milliseconds
}

export interface GiftListing {
  id: string;
  collectionId: string;
  giftId?: string;
  modelId?: string;
  backdropId?: string;
  sellerId: string;
  price: string;
  currency: Currency;
  status: ListingStatus;
  createdAt: number; // Unix timestamp in milliseconds
  updatedAt: number; // Unix timestamp in milliseconds
}

export interface Instrument {
  instrumentKey: string;
  collectionId: string;
  modelId: string;
  backdropId: string;
  currency: Currency;
  name?: string;
  symbol?: string;
  floorPrice?: string;
}

export interface CandleRange {
  startTime: number; // Unix timestamp in milliseconds
  endTime: number;   // Unix timestamp in milliseconds
}

export interface FloorUpdate {
  instrumentKey: string;
  currency: Currency;
  floorPrice: string;
  updatedAt: number; // Unix timestamp in milliseconds
}

export type MarketEvent =
  | { type: "sale"; sequence?: number; data: GiftSale; sale?: GiftSale }
  | { type: "listing"; sequence?: number; data: GiftListing }
  | { type: "candle"; sequence?: number; instrumentKey: string; timeframe: Timeframe; candle: GiftCandle }
  | { type: "candle_update"; sequence?: number; instrumentKey: string; timeframe: Timeframe; candle: GiftCandle }
  | { type: "floor"; sequence?: number; data: FloorUpdate };

// Helper constants for default IDs
export const DEFAULT_MODEL_ID = "all";
export const DEFAULT_BACKDROP_ID = "all";

export interface BuildInstrumentKeyOptions {
  collectionId: string;
  modelId?: string;
  backdropId?: string;
  currency: Currency;
}

export interface ParsedInstrumentKey {
  collectionId: string;
  modelId: string;
  backdropId: string;
  currency: Currency;
}

/**
 * Builds a standardized instrument key in the format: collectionId:modelId:backdropId:currency
 * Optional modelId and backdropId default to "all" if missing or empty or "any".
 */
export function buildInstrumentKey(options: BuildInstrumentKeyOptions): string {
  if (!options || typeof options !== "object") {
    throw new Error("buildInstrumentKey options must be an object");
  }

  const { collectionId, modelId, backdropId, currency } = options;

  if (!collectionId || typeof collectionId !== "string" || collectionId.trim() === "") {
    throw new Error("collectionId must be a non-empty string");
  }

  if (currency !== "TON" && currency !== "STARS") {
    throw new Error(`Invalid currency: "${currency}". Currency must be "TON" or "STARS"`);
  }

  const normCollection = collectionId.trim();

  const normModel = (!modelId || typeof modelId !== "string" || modelId.trim() === "" || modelId.trim() === "any")
    ? DEFAULT_MODEL_ID
    : modelId.trim();

  const normBackdrop = (!backdropId || typeof backdropId !== "string" || backdropId.trim() === "" || backdropId.trim() === "any")
    ? DEFAULT_BACKDROP_ID
    : backdropId.trim();

  if (normCollection.includes(":") || normModel.includes(":") || normBackdrop.includes(":")) {
    throw new Error("Instrument key parts cannot contain colons (:)");
  }

  return `${normCollection}:${normModel}:${normBackdrop}:${currency}`;
}

/**
 * Parses a standardized instrumentKey into its normalized components.
 */
export function parseInstrumentKey(instrumentKey: string): ParsedInstrumentKey {
  if (!instrumentKey || typeof instrumentKey !== "string") {
    throw new Error("instrumentKey must be a non-empty string");
  }

  const parts = instrumentKey.split(":");
  if (parts.length !== 4) {
    throw new Error(`Invalid instrumentKey format: "${instrumentKey}". Expected format "collectionId:modelId:backdropId:currency"`);
  }

  const [rawCollection, rawModel, rawBackdrop, rawCurrency] = parts;

  if (!rawCollection || rawCollection.trim() === "") {
    throw new Error("Invalid instrumentKey: collectionId cannot be empty");
  }

  if (rawCurrency !== "TON" && rawCurrency !== "STARS") {
    throw new Error(`Invalid currency in instrumentKey: "${rawCurrency}". Expected "TON" or "STARS"`);
  }

  const modelId = (!rawModel || rawModel.trim() === "" || rawModel.trim() === "any" || rawModel.trim() === "all")
    ? DEFAULT_MODEL_ID
    : rawModel.trim();

  const backdropId = (!rawBackdrop || rawBackdrop.trim() === "" || rawBackdrop.trim() === "any" || rawBackdrop.trim() === "all")
    ? DEFAULT_BACKDROP_ID
    : rawBackdrop.trim();

  return {
    collectionId: rawCollection.trim(),
    modelId,
    backdropId,
    currency: rawCurrency as Currency,
  };
}

/**
 * Normalizes an arbitrary string key (e.g. simple gift ID "durov-cap" or full key "durov-cap:all:all:TON")
 * into a valid, canonical instrumentKey.
 */
export function normalizeInstrumentKey(keyOrId: string, defaultCurrency: Currency = "TON"): string {
  if (!keyOrId || typeof keyOrId !== "string" || keyOrId.trim() === "") {
    throw new Error("Key or ID must be a non-empty string");
  }

  const trimmed = keyOrId.trim();
  if (trimmed.includes(":")) {
    const parsed = parseInstrumentKey(trimmed);
    return buildInstrumentKey(parsed);
  } else {
    return buildInstrumentKey({
      collectionId: trimmed,
      currency: defaultCurrency,
    });
  }
}

/**
 * Converts Unix milliseconds (backend standard) to Unix seconds (lightweight-charts standard).
 */
export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Converts Unix seconds (lightweight-charts standard) to Unix milliseconds (backend standard).
 */
export function secondsToMs(seconds: number): number {
  return Math.floor(seconds * 1000);
}
