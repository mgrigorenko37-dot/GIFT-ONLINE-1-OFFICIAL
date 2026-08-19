import Decimal from 'decimal.js';
import { ListingStatus, Currency, GiftListing } from '../src/types/market';
import {
  normalizeInstrumentKey,
  parseInstrumentKey,
  buildInstrumentKey,
} from '../src/types/market';

export interface ListingInput {
  listingId?: string;
  id?: string;
  instrumentKey?: string;
  collectionId?: string;
  modelId?: string;
  backdropId?: string;
  giftId?: string;
  price: string | number;
  currency?: Currency;
  sellerId?: string;
  status?: ListingStatus;
  createdAt?: number;
  updatedAt?: number;
}

export interface StoredListing {
  listingId: string;
  instrumentKey: string;
  collectionId: string;
  modelId: string;
  backdropId: string;
  giftId?: string;
  price: string;
  currency: Currency;
  sellerId?: string;
  status: ListingStatus;
  createdAt: number;
  updatedAt: number;
}

export interface FloorResult {
  instrumentKey: string;
  currency: Currency;
  floorPrice: string | null;
  listedCount: number;
  updatedAt: number;
}

const listingsMap = new Map<string, StoredListing>();

type FloorChangeListener = (result: FloorResult, updatedListing?: StoredListing) => void;
const floorListeners: FloorChangeListener[] = [];

export function onFloorUpdated(listener: FloorChangeListener) {
  floorListeners.push(listener);
  return () => {
    const idx = floorListeners.indexOf(listener);
    if (idx !== -1) floorListeners.splice(idx, 1);
  };
}

export function clearFloorState() {
  listingsMap.clear();
}

export function getStoredListings(): StoredListing[] {
  return Array.from(listingsMap.values());
}

export function getListingById(listingId: string): StoredListing | undefined {
  return listingsMap.get(listingId);
}

function parseDecimalPrice(rawPrice: any): Decimal | null {
  if (rawPrice === null || rawPrice === undefined) return null;
  try {
    const dec = new Decimal(rawPrice);
    if (dec.isNaN() || !dec.isFinite() || dec.lte(0)) return null;
    return dec;
  } catch {
    return null;
  }
}

export function normalizeListingInput(input: ListingInput): {
  valid: boolean;
  listing?: StoredListing;
  error?: string;
} {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Invalid input object' };
  }

  const id = (input.listingId || input.id || '').trim();
  if (!id) {
    return { valid: false, error: 'listingId or id is required' };
  }

  let currency: Currency = (input.currency as Currency) || 'TON';
  if (currency !== 'TON' && currency !== 'STARS') {
    return { valid: false, error: 'Invalid currency' };
  }

  let instrumentKey = '';
  if (
    input.instrumentKey &&
    typeof input.instrumentKey === 'string' &&
    input.instrumentKey.trim() !== ''
  ) {
    instrumentKey = normalizeInstrumentKey(input.instrumentKey, currency);
  } else if (
    input.collectionId &&
    typeof input.collectionId === 'string' &&
    input.collectionId.trim() !== ''
  ) {
    instrumentKey = buildInstrumentKey({
      collectionId: input.collectionId,
      modelId: input.modelId,
      backdropId: input.backdropId,
      currency,
    });
  } else {
    return { valid: false, error: 'instrumentKey or collectionId is required' };
  }

  const parsedKey = parseInstrumentKey(instrumentKey);
  currency = parsedKey.currency;

  const priceDec = parseDecimalPrice(input.price);
  if (!priceDec) {
    return { valid: false, error: 'Price must be a positive number' };
  }

  const status: ListingStatus = input.status || 'active';
  if (status !== 'active' && status !== 'sold' && status !== 'cancelled' && status !== 'expired') {
    return { valid: false, error: 'Invalid status' };
  }

  const now = Date.now();
  const createdAt =
    typeof input.createdAt === 'number' && !isNaN(input.createdAt) && input.createdAt > 0
      ? input.createdAt
      : now;
  const updatedAt =
    typeof input.updatedAt === 'number' && !isNaN(input.updatedAt) && input.updatedAt > 0
      ? input.updatedAt
      : now;

  const listing: StoredListing = {
    listingId: id,
    instrumentKey,
    collectionId: parsedKey.collectionId,
    modelId: parsedKey.modelId || '',
    backdropId: parsedKey.backdropId || '',
    giftId: input.giftId ? String(input.giftId).trim() : undefined,
    price: priceDec.toString(),
    currency,
    sellerId: input.sellerId ? String(input.sellerId).trim() : undefined,
    status,
    createdAt,
    updatedAt,
  };

  return { valid: true, listing };
}

export function calculateFloor(
  instrumentKeyOrCol: string,
  defaultCurrency: Currency = 'TON'
): FloorResult {
  const normKey = normalizeInstrumentKey(instrumentKeyOrCol, defaultCurrency);
  const parsed = parseInstrumentKey(normKey);

  const activeListings = Array.from(listingsMap.values()).filter(
    (l) => l.instrumentKey === normKey && l.status === 'active'
  );

  const listedCount = activeListings.length;

  if (listedCount === 0) {
    return {
      instrumentKey: normKey,
      currency: parsed.currency,
      floorPrice: null,
      listedCount: 0,
      updatedAt: Date.now(),
    };
  }

  let minDecimal = new Decimal(activeListings[0].price);
  let latestUpdate = activeListings[0].updatedAt;

  for (let i = 1; i < activeListings.length; i++) {
    const p = new Decimal(activeListings[i].price);
    if (p.lt(minDecimal)) {
      minDecimal = p;
    }
    if (activeListings[i].updatedAt > latestUpdate) {
      latestUpdate = activeListings[i].updatedAt;
    }
  }

  return {
    instrumentKey: normKey,
    currency: parsed.currency,
    floorPrice: minDecimal.toString(),
    listedCount,
    updatedAt: latestUpdate,
  };
}

export function getFloorPrice(
  instrumentKeyOrCol: string,
  defaultCurrency: Currency = 'TON'
): FloorResult {
  return calculateFloor(instrumentKeyOrCol, defaultCurrency);
}

function notifyFloorUpdated(floor: FloorResult, listing?: StoredListing) {
  for (const listener of floorListeners) {
    try {
      listener(floor, listing);
    } catch (err) {
      console.error('Error in floorListener:', err);
    }
  }
}

export function addListing(input: ListingInput): {
  success: boolean;
  listing?: StoredListing;
  floor?: FloorResult;
  error?: string;
} {
  const normRes = normalizeListingInput(input);
  if (!normRes.valid || !normRes.listing) {
    return { success: false, error: normRes.error };
  }

  const listing = normRes.listing;
  listingsMap.set(listing.listingId, listing);

  const floor = calculateFloor(listing.instrumentKey, listing.currency);
  notifyFloorUpdated(floor, listing);

  return { success: true, listing, floor };
}

export function updateListingPrice(
  listingId: string,
  newPrice: string | number
): { success: boolean; listing?: StoredListing; floor?: FloorResult; error?: string } {
  const listing = listingsMap.get(listingId);
  if (!listing) {
    return { success: false, error: 'Listing not found' };
  }

  const priceDec = parseDecimalPrice(newPrice);
  if (!priceDec) {
    return { success: false, error: 'Price must be a positive number' };
  }

  listing.price = priceDec.toString();
  listing.updatedAt = Date.now();

  const floor = calculateFloor(listing.instrumentKey, listing.currency);
  notifyFloorUpdated(floor, listing);

  return { success: true, listing, floor };
}

export function updateListingStatus(
  listingId: string,
  newStatus: ListingStatus
): { success: boolean; listing?: StoredListing; floor?: FloorResult; error?: string } {
  const listing = listingsMap.get(listingId);
  if (!listing) {
    return { success: false, error: 'Listing not found' };
  }

  if (
    newStatus !== 'active' &&
    newStatus !== 'sold' &&
    newStatus !== 'cancelled' &&
    newStatus !== 'expired'
  ) {
    return { success: false, error: 'Invalid status' };
  }

  listing.status = newStatus;
  listing.updatedAt = Date.now();

  const floor = calculateFloor(listing.instrumentKey, listing.currency);
  notifyFloorUpdated(floor, listing);

  return { success: true, listing, floor };
}

export function cancelListing(listingId: string): {
  success: boolean;
  listing?: StoredListing;
  floor?: FloorResult;
  error?: string;
} {
  return updateListingStatus(listingId, 'cancelled');
}

export function expireListing(listingId: string): {
  success: boolean;
  listing?: StoredListing;
  floor?: FloorResult;
  error?: string;
} {
  return updateListingStatus(listingId, 'expired');
}

export function sellListing(listingId: string): {
  success: boolean;
  listing?: StoredListing;
  floor?: FloorResult;
  error?: string;
} {
  return updateListingStatus(listingId, 'sold');
}
