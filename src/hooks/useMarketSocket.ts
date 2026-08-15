import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiftCandle, GiftSale, Timeframe, Currency, parseInstrumentKey } from '../types/market';
import { CandleStore, SequenceTracker, SaleTracker } from '../lib/realtimeStream';
import { FormattedChartCandle } from '../lib/chartHistory';

let sharedSocket: Socket | null = null;

export function getMarketSocket(): Socket {
  if (!sharedSocket) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    sharedSocket = io(origin, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
  }
  return sharedSocket;
}

export interface ActiveMarketConfig {
  instrumentKey: string;
  currency: Currency;
  timeframe: Timeframe;
  requestId: number;
  subscriptionId: string;
}

export interface UseMarketSocketOptions {
  instrumentKey: string;
  timeframe: Timeframe;
  enabled?: boolean;
}

export interface UseMarketSocketReturn {
  isConnected: boolean;
  candles: GiftCandle[];
  chartCandles: FormattedChartCandle[];
  latestChartCandle: FormattedChartCandle | null;
  recentSales: GiftSale[];
  lastSequence: number | null;
  hasSequenceGap: boolean;
  resync: () => void;
  mergeRestCandles: (restCandles: GiftCandle[], configToken?: Partial<ActiveMarketConfig>) => void;
  latestEventCandle: GiftCandle | null;
  activeConfig: ActiveMarketConfig;
}

export function useMarketSocket({
  instrumentKey,
  timeframe,
  enabled = true,
}: UseMarketSocketOptions): UseMarketSocketReturn {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [candles, setCandles] = useState<GiftCandle[]>([]);
  const [recentSales, setRecentSales] = useState<GiftSale[]>([]);
  const [hasSequenceGap, setHasSequenceGap] = useState<boolean>(false);
  const [lastSequence, setLastSequence] = useState<number | null>(null);
  const [latestEventCandle, setLatestEventCandle] = useState<GiftCandle | null>(null);

  // Configuration counters and active token ref
  const subCounterRef = useRef<number>(0);
  const reqCounterRef = useRef<number>(0);

  const getParsedCurrency = (key: string): Currency => {
    try {
      return parseInstrumentKey(key).currency;
    } catch {
      return key.endsWith(':STARS') ? 'STARS' : 'TON';
    }
  };

  const initialConfig = useRef<ActiveMarketConfig>({
    instrumentKey,
    currency: getParsedCurrency(instrumentKey),
    timeframe,
    requestId: 1,
    subscriptionId: 'sub_0_init',
  });

  const activeConfigRef = useRef<ActiveMarketConfig>(initialConfig.current);

  // Core stores stored in refs to prevent unnecessary re-renders
  const candleStoreRef = useRef<CandleStore>(new CandleStore(instrumentKey, timeframe));
  const saleTrackerRef = useRef<SaleTracker>(new SaleTracker(instrumentKey));
  const sequenceTrackerRef = useRef<SequenceTracker>(new SequenceTracker());

  // Helper to re-emit subscription request to server
  const sendSubscribe = useCallback((config: ActiveMarketConfig) => {
    const socket = getMarketSocket();
    if (socket && socket.connected) {
      socket.emit('market_subscribe', {
        instrumentKey: config.instrumentKey,
        timeframe: config.timeframe,
        timeframes: [config.timeframe],
        currency: config.currency,
        subscriptionId: config.subscriptionId,
        requestId: config.requestId,
      });
    }
  }, []);

  // Helper to emit unsubscribe request
  const sendUnsubscribe = useCallback((config: ActiveMarketConfig) => {
    const socket = getMarketSocket();
    if (socket && socket.connected) {
      socket.emit('market_unsubscribe', {
        instrumentKey: config.instrumentKey,
        timeframe: config.timeframe,
        timeframes: [config.timeframe],
        currency: config.currency,
        subscriptionId: config.subscriptionId,
        requestId: config.requestId,
      });
    }
  }, []);

  const resync = useCallback(() => {
    const curConfig = activeConfigRef.current;
    sequenceTrackerRef.current.reset();
    setHasSequenceGap(false);
    sendSubscribe(curConfig);
  }, [sendSubscribe]);

  const mergeRestCandles = useCallback(
    (restCandles: GiftCandle[], configToken?: Partial<ActiveMarketConfig>) => {
      if (!Array.isArray(restCandles)) return;
      const currentConfig = activeConfigRef.current;

      // Validate configuration token to prevent race conditions from delayed REST responses
      if (configToken) {
        if (configToken.instrumentKey && configToken.instrumentKey !== currentConfig.instrumentKey)
          return;
        if (configToken.timeframe && configToken.timeframe !== currentConfig.timeframe) return;
        if (configToken.currency && configToken.currency !== currentConfig.currency) return;
        if (
          configToken.requestId !== undefined &&
          configToken.requestId !== currentConfig.requestId
        )
          return;
        if (
          configToken.subscriptionId !== undefined &&
          configToken.subscriptionId !== currentConfig.subscriptionId
        )
          return;
      }

      // Filter individual candles against current active configuration
      const validCandles = restCandles.filter((c) => {
        if (!c || typeof c !== 'object') return false;
        if (c.instrumentKey && c.instrumentKey !== currentConfig.instrumentKey) return false;
        if (c.timeframe && c.timeframe !== currentConfig.timeframe) return false;
        return true;
      });

      const store = candleStoreRef.current;
      store.mergeCandles(validCandles);
      setCandles(store.getSortedCandles());
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    const socket = getMarketSocket();
    setIsConnected(socket.connected);

    const prevConfig = activeConfigRef.current;

    subCounterRef.current += 1;
    reqCounterRef.current += 1;

    const newCurrency = getParsedCurrency(instrumentKey);
    const newSubId = `sub_${subCounterRef.current}_${Date.now()}`;
    const newReqId = reqCounterRef.current;

    const newConfig: ActiveMarketConfig = {
      instrumentKey,
      currency: newCurrency,
      timeframe,
      requestId: newReqId,
      subscriptionId: newSubId,
    };

    // Unsubscribe from old room if configuration changed
    if (prevConfig.subscriptionId !== newSubId && prevConfig.instrumentKey) {
      sendUnsubscribe(prevConfig);
    }

    activeConfigRef.current = newConfig;

    // Instantly purge old state for previous configuration
    candleStoreRef.current = new CandleStore(instrumentKey, timeframe);
    saleTrackerRef.current = new SaleTracker(instrumentKey);
    sequenceTrackerRef.current = new SequenceTracker();

    setCandles([]);
    setRecentSales([]);
    setHasSequenceGap(false);
    setLastSequence(null);
    setLatestEventCandle(null);

    if (socket.connected) {
      sendSubscribe(newConfig);
    }

    const handleConnect = () => {
      setIsConnected(true);
      sendSubscribe(activeConfigRef.current);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    const handleMarketEvent = (event: any) => {
      if (!event || typeof event !== 'object') return;

      const currentConfig = activeConfigRef.current;

      // 1. Validate instrumentKey isolation
      if (event.instrumentKey && event.instrumentKey !== currentConfig.instrumentKey) {
        return;
      }

      // 2. Validate currency isolation
      if (event.currency && event.currency !== currentConfig.currency) {
        return;
      }

      // 3. Validate subscriptionId / requestId if provided in server event payload
      if (event.subscriptionId && event.subscriptionId !== currentConfig.subscriptionId) {
        return;
      }

      if (event.requestId !== undefined && event.requestId !== currentConfig.requestId) {
        return;
      }

      const seq = event.sequence;

      if (event.type === 'snapshot') {
        const seqRes = sequenceTrackerRef.current.processSequence(seq, true);
        if (seqRes.ok) {
          setLastSequence(seq);
          setHasSequenceGap(false);

          const store = candleStoreRef.current;
          const sales = saleTrackerRef.current;

          // Process snapshot timeframes
          if (Array.isArray(event.timeframes)) {
            const tfData = event.timeframes.find(
              (t: any) => t.timeframe === currentConfig.timeframe
            );
            if (tfData) {
              if (Array.isArray(tfData.closedCandles)) {
                store.mergeCandles(
                  tfData.closedCandles.filter(
                    (c: GiftCandle) =>
                      (!c.instrumentKey || c.instrumentKey === currentConfig.instrumentKey) &&
                      (!c.timeframe || c.timeframe === currentConfig.timeframe)
                  )
                );
              }
              if (tfData.activeCandle) {
                if (
                  (!tfData.activeCandle.instrumentKey ||
                    tfData.activeCandle.instrumentKey === currentConfig.instrumentKey) &&
                  (!tfData.activeCandle.timeframe ||
                    tfData.activeCandle.timeframe === currentConfig.timeframe)
                ) {
                  store.applyCandle(tfData.activeCandle);
                }
              }
              if (Array.isArray(tfData.candles)) {
                store.mergeCandles(
                  tfData.candles.filter(
                    (c: GiftCandle) =>
                      (!c.instrumentKey || c.instrumentKey === currentConfig.instrumentKey) &&
                      (!c.timeframe || c.timeframe === currentConfig.timeframe)
                  )
                );
              }
            }
          } else if (event.timeframes && typeof event.timeframes === 'object') {
            const tfData = event.timeframes[currentConfig.timeframe];
            if (Array.isArray(tfData)) {
              store.mergeCandles(
                tfData.filter(
                  (c: GiftCandle) =>
                    (!c.instrumentKey || c.instrumentKey === currentConfig.instrumentKey) &&
                    (!c.timeframe || c.timeframe === currentConfig.timeframe)
                )
              );
            } else if (tfData && typeof tfData === 'object') {
              if (Array.isArray(tfData.closedCandles)) {
                store.mergeCandles(
                  tfData.closedCandles.filter(
                    (c: GiftCandle) =>
                      (!c.instrumentKey || c.instrumentKey === currentConfig.instrumentKey) &&
                      (!c.timeframe || c.timeframe === currentConfig.timeframe)
                  )
                );
              }
              if (tfData.activeCandle) {
                if (
                  (!tfData.activeCandle.instrumentKey ||
                    tfData.activeCandle.instrumentKey === currentConfig.instrumentKey) &&
                  (!tfData.activeCandle.timeframe ||
                    tfData.activeCandle.timeframe === currentConfig.timeframe)
                ) {
                  store.applyCandle(tfData.activeCandle);
                }
              }
            }
          }

          if (Array.isArray(event.recentSales)) {
            sales.mergeSales(
              event.recentSales.filter(
                (s: GiftSale) => !s.instrumentKey || s.instrumentKey === currentConfig.instrumentKey
              )
            );
          }

          setCandles(store.getSortedCandles());
          setRecentSales(sales.getRecentSales());
        }
        return;
      }

      if (event.type === 'candle_update' || event.type === 'candle_closed') {
        // Validate timeframe isolation
        if (event.timeframe && event.timeframe !== currentConfig.timeframe) {
          return;
        }

        const seqRes = sequenceTrackerRef.current.processSequence(seq, false);
        if (seqRes.gap) {
          setHasSequenceGap(true);
          // Request snapshot / resync for current active config
          sendSubscribe(currentConfig);
          return;
        }

        if (!seqRes.ok) {
          // Stale or duplicate sequence
          return;
        }

        setLastSequence(seq);

        const store = candleStoreRef.current;
        const applyRes = store.applyCandle(event.candle);

        if (applyRes.updated) {
          setCandles(store.getSortedCandles());
          setLatestEventCandle(event.candle);
        }
        return;
      }

      if (event.type === 'sale') {
        const seqRes = sequenceTrackerRef.current.processSequence(seq, false);
        if (seqRes.gap) {
          setHasSequenceGap(true);
          sendSubscribe(currentConfig);
          return;
        }

        if (seqRes.ok) {
          setLastSequence(seq);
          const sales = saleTrackerRef.current;
          if (sales.addSale(event.sale)) {
            setRecentSales(sales.getRecentSales());
          }
        }
        return;
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('market_event', handleMarketEvent);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('market_event', handleMarketEvent);

      sendUnsubscribe(activeConfigRef.current);
    };
  }, [instrumentKey, timeframe, enabled, sendSubscribe, sendUnsubscribe]);

  const chartCandles = candleStoreRef.current.getFormattedChartCandles();
  const latestChartCandle = candleStoreRef.current.getLatestChartCandle();

  return {
    isConnected,
    candles,
    chartCandles,
    latestChartCandle,
    recentSales,
    lastSequence,
    hasSequenceGap,
    resync,
    mergeRestCandles,
    latestEventCandle,
    activeConfig: activeConfigRef.current,
  };
}
