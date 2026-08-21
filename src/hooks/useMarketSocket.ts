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
      reconnectionAttempts: 15,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.5,
      auth: (cb) => {
        const latestInitData =
          typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : '';
        if (latestInitData) {
          cb({ initData: latestInitData });
        } else {
          // Explicit DEMO_AUTH mode for sandboxed browser preview outside Telegram Mini App
          cb({ demoAuth: true });
        }
      },
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
      return key.endsWith(':STARS') ? 'STARS' : 'Gram';
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

          if (Array.isArray(event.recentSales)) {
            saleTrackerRef.current.mergeSales(event.recentSales);
            setRecentSales(saleTrackerRef.current.getRecentSales());
          }

          if (event.timeframes && typeof event.timeframes === 'object') {
            const tfCandles = event.timeframes[currentConfig.timeframe];
            if (Array.isArray(tfCandles)) {
              candleStoreRef.current.mergeCandles(tfCandles);
              setCandles(candleStoreRef.current.getSortedCandles());
            }
          }
        }
        return;
      }

      if (event.type === 'sale') {
        const seqRes = sequenceTrackerRef.current.processSequence(seq);
        if (seqRes.gap) {
          setHasSequenceGap(true);
        }
        if (seqRes.ok) {
          setLastSequence(seq);
          if (event.sale) {
            saleTrackerRef.current.addSale(event.sale);
            setRecentSales(saleTrackerRef.current.getRecentSales());
          }
        }
        return;
      }

      if (
        event.type === 'candle_open' ||
        event.type === 'candle_update' ||
        event.type === 'candle_close'
      ) {
        if (event.timeframe === currentConfig.timeframe && event.candle) {
          const seqRes = sequenceTrackerRef.current.processSequence(seq);
          if (seqRes.gap) {
            setHasSequenceGap(true);
          }
          if (seqRes.ok) {
            setLastSequence(seq);
            const rawCandle = event.candle;
            const candleStart =
              rawCandle.startTime ?? (rawCandle.time ? rawCandle.time * 1000 : Date.now());
            const unifiedCandle: GiftCandle = {
              startTime: candleStart,
              endTime: rawCandle.endTime ?? candleStart + 60000,
              time:
                rawCandle.time ??
                (rawCandle.startTime
                  ? Math.floor(rawCandle.startTime / 1000)
                  : Math.floor(Date.now() / 1000)),
              open: rawCandle.open,
              high: rawCandle.high,
              low: rawCandle.low,
              close: rawCandle.close,
              volume: rawCandle.volume,
              instrumentKey: currentConfig.instrumentKey,
              timeframe: currentConfig.timeframe,
              revision: rawCandle.revision,
              updatedAt: rawCandle.updatedAt,
              tradeCount: rawCandle.tradeCount,
              confirmed: rawCandle.confirmed,
            };

            candleStoreRef.current.applyCandle(unifiedCandle);
            setCandles(candleStoreRef.current.getSortedCandles());
            setLatestEventCandle(unifiedCandle);
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
      if (activeConfigRef.current.instrumentKey) {
        sendUnsubscribe(activeConfigRef.current);
      }
    };
  }, [enabled, instrumentKey, timeframe, sendSubscribe, sendUnsubscribe]);

  // Derived formatted chart candles
  const chartCandles: FormattedChartCandle[] = candles.map((c) => {
    const t = c.startTime ?? c.time ?? 0;
    return {
      time: (t > 1e11 ? Math.floor(t / 1000) : t) as any,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
    };
  });

  const latestChartCandle = chartCandles.length > 0 ? chartCandles[chartCandles.length - 1] : null;

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
