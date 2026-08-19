import {
  GiftSale,
  GiftCandle,
  Timeframe,
  getInstrumentKey,
  createCandleFromSale,
  updateCandle,
  getCandleRange,
  parsePositiveDecimal,
} from './chartEngine';
import { normalizeInstrumentKey, parseInstrumentKey } from '../src/types/market';
import {
  MarketSnapshot,
  IMarketRepository,
  InMemoryMarketRepository,
  resolveMarketRepository,
  OutboxEvent,
} from './marketRepository';

export const allSales: GiftSale[] = [];
export const processedSaleIds = new Set<string>();
export const activeCandles: Record<string, Record<string, GiftCandle>> = {};
export const closedCandles: Record<string, Record<string, GiftCandle[]>> = {};

let activeRepository: IMarketRepository = new InMemoryMarketRepository();

export function setMarketRepository(repo: IMarketRepository) {
  activeRepository = repo;
}

export function getMarketRepository(): IMarketRepository {
  return activeRepository;
}

export function initMarketStateRepository() {
  try {
    const repo = resolveMarketRepository();
    console.log('INIT REPO CALLED. Repo class:', repo.constructor.name);
    setMarketRepository(repo);
  } catch (err) {
    console.error('Failed to resolve market repository:', err);
  }
}

export type SaleAcceptanceReason = 'accepted' | 'duplicate' | 'invalid' | 'not_completed';

export interface CandleChangeEvent {
  type: 'candle_update' | 'candle_closed';
  timeframe: Timeframe;
  candle: GiftCandle;
}

export interface AcceptSaleResult {
  accepted: boolean;
  reason: SaleAcceptanceReason;
  sale?: GiftSale;
  dedupeKey?: string;
  candles?: GiftCandle[];
  candleEvents?: CandleChangeEvent[];
}

type SaleAcceptedListener = (result: AcceptSaleResult) => void;
const saleAcceptedListeners: SaleAcceptedListener[] = [];

export function onSaleAccepted(listener: SaleAcceptedListener) {
  saleAcceptedListeners.push(listener);
  return () => {
    const idx = saleAcceptedListeners.indexOf(listener);
    if (idx !== -1) saleAcceptedListeners.splice(idx, 1);
  };
}

export function clearMarketState(clearRepo = true) {
  allSales.length = 0;
  processedSaleIds.clear();
  for (const k in activeCandles) delete activeCandles[k];
  for (const k in closedCandles) delete closedCandles[k];
  if (clearRepo && activeRepository && typeof activeRepository.clear === 'function') {
    activeRepository.clear();
  }
}

export interface HistoryOptions {
  from?: number;
  to?: number;
  limit?: number;
  cursor?: string;
}

export interface MarketCandlesResponse {
  instrumentKey: string;
  timeframe: Timeframe;
  currency: string;
  timezone: 'UTC';
  candles: GiftCandle[];
  hasMore: boolean;
  nextCursor: string | null;
  serverTime: number;
}

export function getMarketCandlesHistory(
  instrumentKey: string,
  timeframe: Timeframe,
  options: HistoryOptions = {}
): MarketCandlesResponse {
  const normKey = normalizeInstrumentKey(instrumentKey);
  const parsed = parseInstrumentKey(normKey);

  const from = typeof options.from === 'number' && !isNaN(options.from) ? options.from : 0;
  const to =
    typeof options.to === 'number' && !isNaN(options.to) ? options.to : Number.MAX_SAFE_INTEGER;
  const limit =
    typeof options.limit === 'number' && options.limit > 0 ? Math.min(options.limit, 1000) : 500;

  const closed = closedCandles[normKey]?.[timeframe] || [];
  const active = activeCandles[normKey]?.[timeframe];

  // Map by startTime to guarantee uniqueness per (instrumentKey, timeframe, startTime)
  const candleMap = new Map<number, GiftCandle>();

  // Check persistent repository for historical candles if memory buffer is insufficient
  let repoCandles: GiftCandle[] = [];
  try {
    const res = activeRepository.getCandles(normKey, timeframe, { from, to, limit });
    if (res && Array.isArray(res)) repoCandles = res;
  } catch (err) {
    // Ignore async repository read errors in sync method fallback
  }

  for (const c of repoCandles) {
    if (c.startTime >= from && c.startTime < to) {
      candleMap.set(c.startTime, c);
    }
  }

  for (const c of closed) {
    if (c.startTime >= from && c.startTime < to) {
      candleMap.set(c.startTime, c);
    }
  }
  if (active && active.startTime >= from && active.startTime < to) {
    candleMap.set(active.startTime, active);
  }

  let all = Array.from(candleMap.values());
  all.sort((a, b) => a.startTime - b.startTime);

  if (options.cursor) {
    const cursorMs = Number(options.cursor);
    if (!isNaN(cursorMs)) {
      all = all.filter((c) => c.startTime > cursorMs);
    }
  }

  const hasMore = all.length > limit;
  const candles = all.slice(0, limit);
  const nextCursor =
    hasMore && candles.length > 0 ? candles[candles.length - 1].startTime.toString() : null;

  return {
    instrumentKey: normKey,
    timeframe,
    currency: parsed.currency,
    timezone: 'UTC',
    candles,
    hasMore,
    nextCursor,
    serverTime: Date.now(),
  };
}

export function getHistory(
  instrumentKey: string,
  timeframe: Timeframe,
  from: number,
  to: number,
  limit: number = 500
) {
  const res = getMarketCandlesHistory(instrumentKey, timeframe, { from, to, limit });
  return res.candles;
}

export function getActiveCandle(instrumentKey: string, timeframe: Timeframe): GiftCandle | null {
  const normKey = normalizeInstrumentKey(instrumentKey);
  return activeCandles[normKey]?.[timeframe] || null;
}

export function acceptCompletedSale(rawSale: any): AcceptSaleResult {
  if (!rawSale || typeof rawSale !== 'object') {
    return { accepted: false, reason: 'invalid' };
  }

  // 1. Status Check
  if (rawSale.status !== 'completed') {
    return { accepted: false, reason: 'not_completed' };
  }

  // 1b. Simulation / Mock Sale Check
  if (rawSale.isMock || rawSale.isSimulation) {
    const isSimulationActive =
      process.env.SIMULATION_MODE === 'true' || rawSale.allowSimulation === true;
    if (!isSimulationActive) {
      return { accepted: false, reason: 'invalid' };
    }
  }

  // 2. Collection ID Check
  if (
    !rawSale.collectionId ||
    typeof rawSale.collectionId !== 'string' ||
    rawSale.collectionId.trim() === ''
  ) {
    return { accepted: false, reason: 'invalid' };
  }

  // 3. Currency Check
  if (rawSale.currency !== 'TON' && rawSale.currency !== 'STARS') {
    return { accepted: false, reason: 'invalid' };
  }

  // 4. Price Check
  const pDec = parsePositiveDecimal(rawSale.price);
  if (!pDec) {
    return { accepted: false, reason: 'invalid' };
  }

  // 5. Quantity Check
  const qDec = parsePositiveDecimal(rawSale.quantity);
  if (!qDec) {
    return { accepted: false, reason: 'invalid' };
  }

  // 6. Timestamp Check
  const eventTime = Number(rawSale.eventTime);
  if (
    typeof rawSale.eventTime !== 'number' ||
    isNaN(eventTime) ||
    !isFinite(eventTime) ||
    eventTime < 0
  ) {
    return { accepted: false, reason: 'invalid' };
  }

  // Detect timestamp in seconds instead of milliseconds (e.g. 10-digit timestamp like 1710000000)
  if (eventTime > 0 && eventTime < 100000000000) {
    return { accepted: false, reason: 'invalid' };
  }

  // 7. Dedupe Key Formulation
  let dedupeKey = '';
  if (typeof rawSale.id === 'string' && rawSale.id.trim() !== '') {
    dedupeKey = rawSale.id.trim();
  } else if (rawSale.transactionHash && rawSale.giftId && typeof rawSale.eventTime === 'number') {
    dedupeKey = `${rawSale.transactionHash}_${rawSale.giftId}_${rawSale.eventTime}`;
  } else {
    return { accepted: false, reason: 'invalid' };
  }

  // 8. Deduplication Check
  if (processedSaleIds.has(dedupeKey)) {
    return { accepted: false, reason: 'duplicate', dedupeKey };
  }

  // 9. Normalize & Form GiftSale
  const sale: GiftSale = {
    id: dedupeKey,
    collectionId: rawSale.collectionId.trim(),
    modelId: rawSale.modelId ? String(rawSale.modelId).trim() : undefined,
    backdropId: rawSale.backdropId ? String(rawSale.backdropId).trim() : undefined,
    price: pDec.toString(),
    quantity: qDec.toString(),
    currency: rawSale.currency,
    eventTime,
    createdAt:
      typeof rawSale.createdAt === 'number' && !isNaN(rawSale.createdAt)
        ? rawSale.createdAt
        : eventTime,
    status: 'completed',
    isMock: Boolean(rawSale.isMock || rawSale.isSimulation),
    transactionHash: rawSale.transactionHash ? String(rawSale.transactionHash) : undefined,
    giftId: rawSale.giftId ? String(rawSale.giftId) : undefined,
  };

  // Update market candles internal state
  const { updatedCandles, candleEvents } = processSaleInternal(sale);

  // Register dedupe key before updating state
  processedSaleIds.add(dedupeKey);
  if (processedSaleIds.size > 100000) {
    const toRemove = processedSaleIds.size - 50000;
    let count = 0;
    for (const id of processedSaleIds) {
      processedSaleIds.delete(id);
      count++;
      if (count >= toRemove) break;
    }
  }

  allSales.push(sale);
  if (allSales.length > 20000) {
    allSales.splice(0, allSales.length - 10000);
  }

  // Construct outbox event for transactional messaging
  const outboxEvent: OutboxEvent = {
    eventId: `evt_sale_${sale.id}`,
    eventType: 'sale_accepted',
    aggregateType: 'sale',
    aggregateId: sale.id,
    instrumentKey: getInstrumentKey(sale),
    payload: {
      sale,
      candles: updatedCandles,
      candleEvents,
    },
    status: 'pending',
    attempts: 0,
    availableAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Persist sale, updated candles, and outbox event atomically to active repository
  try {
    if (activeRepository.saveSaleAndCandlesAtomic) {
      const p = activeRepository.saveSaleAndCandlesAtomic(sale, updatedCandles, [outboxEvent]);
      if (p && typeof (p as any).catch === 'function') {
        (p as any).catch((err: any) =>
          console.error('Error persisting sale to market repository:', err)
        );
      }
    } else {
      const p = activeRepository.saveSale(sale);
      if (p && typeof (p as any).catch === 'function') {
        (p as any).catch((err: any) => console.error('Error persisting sale:', err));
      }
      if (activeRepository.saveOutboxEvent) {
        const p2 = activeRepository.saveOutboxEvent(outboxEvent);
        if (p2 && typeof (p2 as any).catch === 'function') {
          (p2 as any).catch((err: any) => console.error('Error persisting outbox event:', err));
        }
      }
      const normKey = getInstrumentKey(sale);
      for (const c of updatedCandles) {
        const closedList = closedCandles[normKey]?.[c.timeframe] || [];
        const p3 = activeRepository.saveCandles(normKey, c.timeframe, closedList);
        if (p3 && typeof (p3 as any).catch === 'function') {
          (p3 as any).catch((err: any) => console.error('Error persisting candles:', err));
        }
      }
    }
  } catch (err) {
    console.error('Error persisting sale to market repository:', err);
  }

  const res: AcceptSaleResult = {
    accepted: true,
    reason: 'accepted',
    sale,
    dedupeKey,
    candles: updatedCandles,
    candleEvents,
  };

  for (const listener of saleAcceptedListeners) {
    try {
      const p = listener(res) as unknown as Promise<unknown>;
      if (p && typeof p.catch === 'function') {
        (p as any).catch((err: any) => {
          console.warn(
            '[MarketState] Async saleAcceptedListener rejection caught:',
            err?.message || err
          );
        });
      }
    } catch (err) {
      console.error('Error in saleAcceptedListener:', err);
    }
  }

  return res;
}

interface ProcessSaleInternalResult {
  updatedCandles: GiftCandle[];
  candleEvents: CandleChangeEvent[];
}

function processSaleInternal(sale: GiftSale): ProcessSaleInternalResult {
  const instrumentKey = getInstrumentKey(sale);

  if (!activeCandles[instrumentKey]) {
    activeCandles[instrumentKey] = {};
  }
  if (!closedCandles[instrumentKey]) {
    closedCandles[instrumentKey] = {};
  }

  const timeframes: Timeframe[] = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
  const updatedCandles: GiftCandle[] = [];
  const candleEvents: CandleChangeEvent[] = [];

  for (const tf of timeframes) {
    if (!closedCandles[instrumentKey][tf]) {
      closedCandles[instrumentKey][tf] = [];
    }

    let currentCandle = activeCandles[instrumentKey][tf];

    if (!currentCandle) {
      currentCandle = createCandleFromSale(sale, tf);
      activeCandles[instrumentKey][tf] = currentCandle;
      updatedCandles.push(currentCandle);
      candleEvents.push({ type: 'candle_update', timeframe: tf, candle: { ...currentCandle } });
    } else {
      if (sale.eventTime >= currentCandle.endTime) {
        currentCandle.confirmed = true;
        const closedCopy = { ...currentCandle };
        closedCandles[instrumentKey][tf].push(closedCopy);
        candleEvents.push({ type: 'candle_closed', timeframe: tf, candle: closedCopy });

        currentCandle = createCandleFromSale(sale, tf);
        activeCandles[instrumentKey][tf] = currentCandle;
        updatedCandles.push(currentCandle);
        candleEvents.push({ type: 'candle_update', timeframe: tf, candle: { ...currentCandle } });
      } else if (sale.eventTime < currentCandle.startTime) {
        const pastRange = getCandleRange(sale.eventTime, tf);
        const pastCandleIdx = closedCandles[instrumentKey][tf].findIndex(
          (c) => c.startTime === pastRange.startTime
        );
        if (pastCandleIdx !== -1) {
          const pc = closedCandles[instrumentKey][tf][pastCandleIdx];
          const updatedPc = updateCandle(pc, sale);
          closedCandles[instrumentKey][tf][pastCandleIdx] = updatedPc;
          updatedCandles.push(updatedPc);
          candleEvents.push({ type: 'candle_update', timeframe: tf, candle: { ...updatedPc } });
        } else {
          const newClosed = createCandleFromSale(sale, tf);
          newClosed.confirmed = true;
          closedCandles[instrumentKey][tf].push(newClosed);
          closedCandles[instrumentKey][tf].sort((a, b) => a.startTime - b.startTime);
          updatedCandles.push(newClosed);
          candleEvents.push({ type: 'candle_closed', timeframe: tf, candle: { ...newClosed } });
        }
      } else {
        currentCandle = updateCandle(currentCandle, sale);
        activeCandles[instrumentKey][tf] = currentCandle;
        updatedCandles.push(currentCandle);
        candleEvents.push({ type: 'candle_update', timeframe: tf, candle: { ...currentCandle } });
      }
    }

    if (closedCandles[instrumentKey][tf].length > 5000) {
      closedCandles[instrumentKey][tf] = closedCandles[instrumentKey][tf].slice(-5000);
    }
  }

  return { updatedCandles, candleEvents };
}

export function getMarketSnapshot(instrumentKey: string, timeframes?: Timeframe[] | null) {
  const normKey = normalizeInstrumentKey(instrumentKey);
  const parsed = parseInstrumentKey(normKey);

  const ALL_TF: Timeframe[] = ['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
  const tfsToInclude = timeframes && timeframes.length > 0 ? timeframes : ALL_TF;

  const timeframesData: Record<string, GiftCandle[]> = {};

  for (const tf of tfsToInclude) {
    const closed = closedCandles[normKey]?.[tf] || [];
    const active = activeCandles[normKey]?.[tf];

    const candleMap = new Map<number, GiftCandle>();
    for (const c of closed) {
      candleMap.set(c.startTime, c);
    }
    if (active) {
      candleMap.set(active.startTime, active);
    }
    const list = Array.from(candleMap.values());
    list.sort((a, b) => a.startTime - b.startTime);
    timeframesData[tf] = list;
  }

  const recentSales = allSales.filter((s) => getInstrumentKey(s) === normKey).slice(-50);

  return {
    instrumentKey: normKey,
    currency: parsed.currency,
    timeframes: timeframesData,
    recentSales,
    serverTime: Date.now(),
  };
}

export function processSale(sale: GiftSale): GiftCandle[] | null {
  const res = acceptCompletedSale(sale);
  return res.accepted ? res.candles || [] : null;
}

export function serializeMarketState(isSimulation = false): MarketSnapshot {
  return {
    version: 1,
    timestamp: Date.now(),
    allSales: JSON.parse(JSON.stringify(allSales)),
    processedSaleIds: Array.from(processedSaleIds),
    activeCandles: JSON.parse(JSON.stringify(activeCandles)),
    closedCandles: JSON.parse(JSON.stringify(closedCandles)),
    isSimulation,
  };
}

export function restoreMarketState(
  snapshot: MarketSnapshot | null,
  options?: { allowSimulation?: boolean }
): { success: boolean; restoredSalesCount: number } {
  clearMarketState();
  if (!snapshot || typeof snapshot !== 'object') {
    return { success: false, restoredSalesCount: 0 };
  }

  const allowSim = Boolean(options?.allowSimulation || process.env.SIMULATION_MODE === 'true');

  // Restore sales
  for (const s of snapshot.allSales || []) {
    if (!s || !s.id) continue;
    if (s.isMock && !allowSim) continue; // Exclude mock sales in production mode
    allSales.push(s);
    processedSaleIds.add(s.id);
  }

  // Restore dedupe IDs
  for (const id of snapshot.processedSaleIds || []) {
    if (typeof id === 'string' && id.trim() !== '') {
      processedSaleIds.add(id);
    }
  }

  // Restore active candles with validation (no empty or NaN candles)
  if (snapshot.activeCandles) {
    for (const instKey in snapshot.activeCandles) {
      for (const tf in snapshot.activeCandles[instKey]) {
        const c = snapshot.activeCandles[instKey][tf];
        if (
          c &&
          c.tradeCount > 0 &&
          c.open &&
          c.high &&
          c.low &&
          c.close &&
          !isNaN(Number(c.open)) &&
          !isNaN(Number(c.close))
        ) {
          if (!activeCandles[instKey]) activeCandles[instKey] = {};
          activeCandles[instKey][tf] = c;
        }
      }
    }
  }

  // Restore closed candles with deduplication by startTime and removal of empty candles
  if (snapshot.closedCandles) {
    for (const instKey in snapshot.closedCandles) {
      for (const tf in snapshot.closedCandles[instKey]) {
        const rawList = snapshot.closedCandles[instKey][tf] || [];
        const map = new Map<number, GiftCandle>();
        for (const c of rawList) {
          if (
            c &&
            c.tradeCount > 0 &&
            c.open &&
            c.high &&
            c.low &&
            c.close &&
            !isNaN(Number(c.open)) &&
            !isNaN(Number(c.close))
          ) {
            map.set(c.startTime, c);
          }
        }
        const cleanList = Array.from(map.values()).sort((a, b) => a.startTime - b.startTime);
        if (!closedCandles[instKey]) closedCandles[instKey] = {};
        closedCandles[instKey][tf] = cleanList;
      }
    }
  }

  return { success: true, restoredSalesCount: allSales.length };
}
