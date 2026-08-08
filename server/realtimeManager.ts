import { Server, Socket } from 'socket.io';
import { normalizeInstrumentKey, parseInstrumentKey, buildInstrumentKey, Timeframe, Currency } from '../src/types/market';
import { onSaleAccepted, AcceptSaleResult, getMarketSnapshot } from './marketState';
import { onFloorUpdated, getFloorPrice, FloorResult } from './floorManager';
import { getInstrumentKey } from './chartEngine';

export const VALID_TIMEFRAMES = new Set<Timeframe>([
  "1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"
]);

export const TIMEFRAME_ORDER: Record<Timeframe, number> = {
  "1s": 1,
  "1m": 2,
  "5m": 3,
  "15m": 4,
  "1h": 5,
  "4h": 6,
  "1d": 7,
  "1w": 8,
  "1M": 9
};

export interface SubscriptionInfo {
  subKey: string;
  instrumentKey: string;
  timeframes: Timeframe[] | null; // null means ALL timeframes
  socket: Socket;
}

// Global sequence counter for all emitted market_event messages
let globalSequence = 0;

export function getNextSequence(): number {
  return ++globalSequence;
}

export function resetSequence(value: number = 0) {
  globalSequence = value;
}

// Map: socketId -> (subKey -> SubscriptionInfo)
const socketSubscriptions = new Map<string, Map<string, SubscriptionInfo>>();

export function parseSubscriptionParams(data: any): { instrumentKey: string; timeframes: Timeframe[] | null } {
  if (!data) {
    throw new Error("Subscription data is required");
  }

  let rawKey = '';
  let rawCol = '';
  let rawModel = '';
  let rawBackdrop = '';
  let rawCurr = '';
  let rawTf = '';
  let rawTfs: any = null;

  if (typeof data === 'string') {
    rawKey = data.trim();
  } else if (typeof data === 'object') {
    rawKey = data.instrumentKey ? String(data.instrumentKey).trim() : '';
    rawCol = data.collectionId ? String(data.collectionId).trim() : '';
    rawModel = data.modelId ? String(data.modelId).trim() : '';
    rawBackdrop = data.backdropId ? String(data.backdropId).trim() : '';
    rawCurr = data.currency ? String(data.currency).trim() : '';
    rawTf = data.timeframe ? String(data.timeframe).trim() : '';
    rawTfs = data.timeframes;
  }

  let instrumentKey = '';
  if (rawKey) {
    instrumentKey = normalizeInstrumentKey(rawKey, (rawCurr as Currency) || 'TON');
  } else if (rawCol) {
    instrumentKey = buildInstrumentKey({
      collectionId: rawCol,
      modelId: rawModel,
      backdropId: rawBackdrop,
      currency: (rawCurr as Currency) || 'TON'
    });
  } else {
    throw new Error("instrumentKey or collectionId is required");
  }

  let timeframes: Timeframe[] | null = null;

  if (Array.isArray(rawTfs)) {
    const valid = rawTfs.map(t => String(t).trim()).filter(t => VALID_TIMEFRAMES.has(t as Timeframe)) as Timeframe[];
    if (valid.length > 0) {
      timeframes = Array.from(new Set(valid)).sort((a, b) => TIMEFRAME_ORDER[a] - TIMEFRAME_ORDER[b]);
    }
  } else if (rawTf) {
    if (rawTf !== 'all' && rawTf !== '*') {
      if (!VALID_TIMEFRAMES.has(rawTf as Timeframe)) {
        throw new Error(`Invalid timeframe: ${rawTf}`);
      }
      timeframes = [rawTf as Timeframe];
    }
  }

  return { instrumentKey, timeframes };
}

export function handleSubscribe(socket: any, data: any): { success: boolean; isDuplicate: boolean; subKey?: string; error?: string } {
  try {
    const { instrumentKey, timeframes } = parseSubscriptionParams(data);
    const timeframesPart = timeframes ? timeframes.join(',') : 'ALL';
    const subKey = `${instrumentKey}::${timeframesPart}`;

    const socketId = socket.id || 'mock_socket';

    if (!socketSubscriptions.has(socketId)) {
      socketSubscriptions.set(socketId, new Map());
    }

    const subsMap = socketSubscriptions.get(socketId)!;

    if (subsMap.has(subKey)) {
      // Duplicate subscription: do not create second stream, emit snapshot for recovery
      emitSnapshot(socket, instrumentKey, timeframes);
      return { success: true, isDuplicate: true, subKey };
    }

    const subInfo: SubscriptionInfo = {
      subKey,
      instrumentKey,
      timeframes,
      socket
    };

    subsMap.set(subKey, subInfo);

    if (typeof socket.join === 'function') {
      socket.join(`market_${instrumentKey}`);
    }

    emitSnapshot(socket, instrumentKey, timeframes);

    return { success: true, isDuplicate: false, subKey };
  } catch (err: any) {
    return { success: false, isDuplicate: false, error: err.message || "Failed to subscribe" };
  }
}

export function handleUnsubscribe(socket: any, data: any): { success: boolean; removedCount: number } {
  const socketId = socket.id || 'mock_socket';
  const subsMap = socketSubscriptions.get(socketId);
  if (!subsMap || subsMap.size === 0) {
    return { success: true, removedCount: 0 };
  }

  let removedCount = 0;

  try {
    const { instrumentKey, timeframes } = parseSubscriptionParams(data);
    const timeframesPart = timeframes ? timeframes.join(',') : 'ALL';
    const exactSubKey = `${instrumentKey}::${timeframesPart}`;

    if (subsMap.has(exactSubKey)) {
      subsMap.delete(exactSubKey);
      removedCount++;
    } else {
      // If exact subKey not found, remove any subscription for this instrumentKey
      for (const [key, sub] of Array.from(subsMap.entries())) {
        if (sub.instrumentKey === instrumentKey) {
          subsMap.delete(key);
          removedCount++;
        }
      }
    }

    if (subsMap.size === 0) {
      socketSubscriptions.delete(socketId);
    }

    if (typeof socket.leave === 'function') {
      socket.leave(`market_${instrumentKey}`);
    }
  } catch {
    // If parsing failed (e.g. invalid data), try deleting by raw string if present
    if (typeof data === 'string' && subsMap.has(data)) {
      subsMap.delete(data);
      removedCount++;
    }
  }

  return { success: true, removedCount };
}

export function handleDisconnect(socket: any) {
  const socketId = socket.id || 'mock_socket';
  socketSubscriptions.delete(socketId);
}

export function getSocketSubscriptions(socketId: string): SubscriptionInfo[] {
  const subsMap = socketSubscriptions.get(socketId);
  return subsMap ? Array.from(subsMap.values()) : [];
}

export function clearAllSubscriptions() {
  socketSubscriptions.clear();
}

function emitSnapshot(socket: any, instrumentKey: string, timeframes: Timeframe[] | null) {
  const snapshotData = getMarketSnapshot(instrumentKey, timeframes);
  const floorData = getFloorPrice(instrumentKey);
  const sequence = getNextSequence();

  const payload = {
    type: 'snapshot',
    sequence,
    instrumentKey,
    timeframes: snapshotData.timeframes,
    recentSales: snapshotData.recentSales,
    floorPrice: floorData.floorPrice,
    listedCount: floorData.listedCount,
    serverTime: snapshotData.serverTime
  };

  if (typeof socket.emit === 'function') {
    socket.emit('market_event', payload);
    socket.emit('floor_update', floorData);
  }
}

export function broadcastSaleResult(result: AcceptSaleResult) {
  if (!result.accepted || !result.sale) return;

  const sale = result.sale;
  const instrumentKey = getInstrumentKey(sale);
  const candleEvents = result.candleEvents || [];

  const saleSequence = getNextSequence();
  const saleEvent = {
    type: 'sale',
    sequence: saleSequence,
    instrumentKey,
    sale
  };

  for (const [, subsMap] of socketSubscriptions) {
    let saleSentToSocket = false;

    for (const sub of subsMap.values()) {
      if (sub.instrumentKey === instrumentKey) {
        if (!saleSentToSocket) {
          if (typeof sub.socket.emit === 'function') {
            sub.socket.emit('market_event', saleEvent);
          }
          saleSentToSocket = true;
        }

        for (const ce of candleEvents) {
          if (sub.timeframes === null || sub.timeframes.includes(ce.timeframe)) {
            const candleSequence = getNextSequence();
            const candleEvent = {
              type: ce.type,
              sequence: candleSequence,
              instrumentKey,
              timeframe: ce.timeframe,
              candle: ce.candle
            };

            if (typeof sub.socket.emit === 'function') {
              sub.socket.emit('market_event', candleEvent);
            }
          }
        }
      }
    }
  }
}

export function broadcastFloorResult(floorResult: FloorResult) {
  const sequence = getNextSequence();
  const floorEvent = {
    type: 'floor_update',
    sequence,
    instrumentKey: floorResult.instrumentKey,
    currency: floorResult.currency,
    floorPrice: floorResult.floorPrice,
    listedCount: floorResult.listedCount,
    updatedAt: floorResult.updatedAt,
  };

  for (const [, subsMap] of socketSubscriptions) {
    let sentToSocket = false;
    for (const sub of subsMap.values()) {
      if (sub.instrumentKey === floorResult.instrumentKey) {
        if (!sentToSocket && typeof sub.socket.emit === 'function') {
          sub.socket.emit('floor_update', floorResult);
          sub.socket.emit('market_event', floorEvent);
          sentToSocket = true;
        }
      }
    }
  }
}

// Auto-register listener on marketState sale acceptance
onSaleAccepted((result) => {
  broadcastSaleResult(result);
});

// Auto-register listener on floor update
onFloorUpdated((floorResult) => {
  broadcastFloorResult(floorResult);
});

export function attachSocketListeners(socket: any) {
  socket.on('market_subscribe', (data: any) => {
    handleSubscribe(socket, data);
  });

  socket.on('market_unsubscribe', (data: any) => {
    handleUnsubscribe(socket, data);
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
}

export function initRealtimeManager(io: Server) {
  io.on('connection', (socket: Socket) => {
    attachSocketListeners(socket);
  });
}
