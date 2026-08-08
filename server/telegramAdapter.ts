import { acceptCompletedSale, AcceptSaleResult } from './marketState';

export type TelegramEventStatus = 'completed' | 'pending' | 'cancelled' | 'failed' | 'reverted' | 'unknown';
export type TelegramEventSource = 'real' | 'simulation' | 'test' | 'replay';

export interface RawTelegramMarketEvent {
  event_id?: string;
  id?: string;
  sale_id?: string;
  transaction_hash?: string;
  transactionHash?: string;
  collection_id?: string;
  collectionId?: string;
  gift_id?: string;
  giftId?: string;
  model_id?: string;
  modelId?: string;
  backdrop_id?: string;
  backdropId?: string;
  currency?: 'TON' | 'STARS' | string;
  price?: string | number;
  quantity?: string | number;
  event_time?: number | string;
  eventTime?: number | string;
  status?: TelegramEventStatus | string;
  source?: TelegramEventSource | string;
  is_mock?: boolean;
  isMock?: boolean;
  is_simulation?: boolean;
  isSimulation?: boolean;
}

export interface IngestionResponse {
  success: boolean;
  processed: boolean;
  reason: string;
  saleId?: string;
  dedupeKey?: string;
  result?: AcceptSaleResult;
}

export function processTelegramMarketEvent(rawPayload: unknown): IngestionResponse {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      success: false,
      processed: false,
      reason: 'malformed_payload: payload must be a non-null object',
    };
  }

  const p = rawPayload as RawTelegramMarketEvent;

  // 1. Extract and normalize status
  const rawStatus = (p.status || 'completed').toString().toLowerCase().trim();
  const status: TelegramEventStatus = ['completed', 'pending', 'cancelled', 'failed', 'reverted'].includes(rawStatus)
    ? (rawStatus as TelegramEventStatus)
    : 'unknown';

  if (status === 'unknown') {
    return {
      success: false,
      processed: false,
      reason: `invalid_status: unknown event status "${p.status}"`,
    };
  }

  // Non-completed status handlers
  if (status === 'pending') {
    return { success: true, processed: false, reason: 'ignored_pending_status' };
  }
  if (status === 'cancelled') {
    return { success: true, processed: false, reason: 'ignored_cancelled_status' };
  }
  if (status === 'failed') {
    return { success: true, processed: false, reason: 'ignored_failed_status' };
  }
  if (status === 'reverted') {
    return { success: true, processed: false, reason: 'reverted_status_flagged' };
  }

  // 2. Collection ID
  const collectionId = (p.collectionId || p.collection_id || '').toString().trim();
  if (!collectionId) {
    return { success: false, processed: false, reason: 'validation_error: collectionId is required' };
  }

  // 3. Currency
  const currencyStr = (p.currency || 'TON').toString().toUpperCase().trim();
  if (currencyStr !== 'TON' && currencyStr !== 'STARS') {
    return { success: false, processed: false, reason: `validation_error: invalid currency "${currencyStr}"` };
  }

  // 4. Price & Quantity
  const priceRaw = p.price;
  if (priceRaw === undefined || priceRaw === null) {
    return { success: false, processed: false, reason: 'validation_error: price is required' };
  }
  const priceNum = Number(priceRaw);
  if (isNaN(priceNum) || !isFinite(priceNum) || priceNum <= 0) {
    return { success: false, processed: false, reason: 'validation_error: price must be a positive number' };
  }

  const qtyRaw = p.quantity !== undefined && p.quantity !== null ? p.quantity : 1;
  const qtyNum = Number(qtyRaw);
  if (isNaN(qtyNum) || !isFinite(qtyNum) || qtyNum <= 0) {
    return { success: false, processed: false, reason: 'validation_error: quantity must be a positive number' };
  }

  // 5. Event Time
  let eventTimeNum = Number(p.eventTime || p.event_time);
  if (isNaN(eventTimeNum) || !isFinite(eventTimeNum) || eventTimeNum <= 0) {
    return { success: false, processed: false, reason: 'validation_error: eventTime is required' };
  }
  // Convert 10-digit seconds timestamp to 13-digit milliseconds timestamp if needed
  if (eventTimeNum > 0 && eventTimeNum < 100000000000) {
    eventTimeNum = eventTimeNum * 1000;
  }

  // 6. Stable Sale ID & Transaction Hash
  const txHash = p.transactionHash || p.transaction_hash;
  const giftId = p.giftId || p.gift_id;
  const saleIdCandidate = p.sale_id || p.saleId || p.id || p.event_id;

  let finalSaleId = '';
  if (saleIdCandidate && saleIdCandidate.toString().trim() !== '') {
    finalSaleId = saleIdCandidate.toString().trim();
  } else if (txHash && giftId && eventTimeNum) {
    finalSaleId = `${txHash}_${giftId}_${eventTimeNum}`;
  } else if (txHash) {
    finalSaleId = `${txHash}_${eventTimeNum}`;
  } else {
    return {
      success: false,
      processed: false,
      reason: 'validation_error: unable to construct a stable unique saleId or transactionHash',
    };
  }

  // 7. Source & Simulation flag
  const isSimulation = Boolean(p.isMock || p.is_mock || p.isSimulation || p.is_simulation || p.source === 'simulation');
  const source: TelegramEventSource = isSimulation ? 'simulation' : ((p.source as any) || 'real');

  // Construct normalized sale
  const normalizedSale = {
    id: finalSaleId,
    collectionId,
    giftId: giftId ? giftId.toString().trim() : undefined,
    modelId: (p.modelId || p.model_id || '').toString().trim() || undefined,
    backdropId: (p.backdropId || p.backdrop_id || '').toString().trim() || undefined,
    currency: currencyStr as 'TON' | 'STARS',
    price: priceRaw.toString(),
    quantity: qtyRaw.toString(),
    eventTime: eventTimeNum,
    createdAt: eventTimeNum,
    status: 'completed',
    transactionHash: txHash ? txHash.toString().trim() : undefined,
    isMock: isSimulation,
    isSimulation,
    source,
  };

  // Pass to completed sale ingestion pipeline
  const result = acceptCompletedSale(normalizedSale);

  if (result.accepted) {
    return {
      success: true,
      processed: true,
      reason: 'accepted',
      saleId: finalSaleId,
      dedupeKey: result.dedupeKey,
      result,
    };
  } else {
    return {
      success: true,
      processed: false,
      reason: result.reason,
      saleId: finalSaleId,
      dedupeKey: result.dedupeKey,
      result,
    };
  }
}
