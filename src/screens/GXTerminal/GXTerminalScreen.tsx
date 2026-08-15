import { useMemo, useState, useEffect, useRef, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  UTCTimestamp,
} from 'lightweight-charts';
import { io } from 'socket.io-client';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { formatGX } from '../../data/gifts';
import { useGifts } from '../../context/GiftsContext';
import { useLanguage } from '../../context/LanguageContext';
import { Timeframe, Currency, buildInstrumentKey, msToSeconds } from '../../types/market';
import { fetchMarketCandles } from '../../lib/marketApi';
import { processCandlesForChart } from '../../lib/chartHistory';
import { useMarketSocket } from '../../hooks/useMarketSocket';

type OpenOrder = {
  id: string;
  side: 'buy' | 'sell';
  type: 'Limit' | 'Market';
  giftName: string;
  amount: number;
  filled: number;
  price: number;
  status: 'open' | 'filled' | 'cancelled';
  time: number;
};

type Trade = {
  id: string;
  giftName: string;
  price: number;
  amount: number;
  time: number;
  takerSide: 'buy' | 'sell';
};

const balance = 12480.5;

function GiftArtwork({
  className,
  small,
  emoji,
}: {
  className: string;
  small?: boolean;
  emoji?: string;
}) {
  if (emoji) {
    return (
      <div
        className={`gx-gift-artwork ${className} ${small ? 'is-small' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: small ? '24px' : '48px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: '12px',
        }}
      >
        <img
          src={`https://emojik.vercel.app/s/${emoji}`}
          alt='emoji'
          style={{ width: small ? '24px' : '48px', height: small ? '24px' : '48px' }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.parentElement!.innerHTML = emoji;
          }}
        />
      </div>
    );
  }
  return (
    <div className={`gx-gift-artwork ${className} ${small ? 'is-small' : ''}`}>
      <div className='gx-gift-box' />
    </div>
  );
}

const GXTerminalScreen = () => {
  const { gifts, loading } = useGifts();
  const navigate = useNavigate();
  const { currentLang, openLangModal, t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const [giftId, setGiftId] = useState(searchParams.get('gift') || 'durov-cap');
  const { isTelegram, user } = useTelegramWebApp();

  const activeGift = useMemo(() => gifts.find((g) => g.id === giftId) || gifts[0], [giftId, gifts]);
  const [mktPanelOpen, setMktPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('TON');
  const [chartLoading, setChartLoading] = useState<boolean>(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [isChartEmpty, setIsChartEmpty] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);

  const [expandedGiftId, setExpandedGiftId] = useState<string | null>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<any>(null);

  const activeInstrumentKey = useMemo(() => {
    return buildInstrumentKey({
      collectionId: activeGift?.id || 'durov-cap',
      currency: selectedCurrency,
      modelId: selectedVariant?.model_id,
      backdropId: selectedVariant?.backdrop_id,
    });
  }, [activeGift?.id, selectedCurrency, selectedVariant]);

  const {
    isConnected: isSocketConnected,
    chartCandles: realtimeChartCandles,
    latestChartCandle,
    recentSales: socketRecentSales,
    mergeRestCandles,
    activeConfig,
  } = useMarketSocket({
    instrumentKey: activeInstrumentKey,
    timeframe,
    enabled: true,
  });
  const filteredGifts = gifts.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (expandedGiftId) {
      setVariantLoading(true);
      fetch(`/api/variants/${expandedGiftId}`)
        .then((res) => {
          if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return [];
          return res.json();
        })
        .then((data) => {
          setVariants(Array.isArray(data) ? data : []);
          setVariantLoading(false);
        })
        .catch(() => setVariantLoading(false));
    } else {
      setVariants([]);
    }
  }, [expandedGiftId]);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'Limit' | 'Market'>('Limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState((activeGift?.floor || 0).toFixed(2));
  const [toast, setToast] = useState('');

  const [activityTab, setActivityTab] = useState<'positions' | 'open' | 'history'>('positions');

  const [orderBook, setOrderBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const curPrice = recentTrades[0]?.price || activeGift?.floor || 0;
  const [userOrders, setUserOrders] = useState<OpenOrder[]>([]);
  const [balance, setBalance] = useState(12480.5);
  const [positions, setPositions] = useState<any[]>([]);
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [confirmClose, setConfirmClose] = useState<{
    show: boolean;
    side: 'buy' | 'sell';
    qty: number;
    price: number;
    isMarket: boolean;
    reduceOnly: boolean;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const socketRef = useRef<any>(null);

  useEffect(() => {
    // Reset price when gift changes
    setPrice((activeGift?.floor || 0).toFixed(2));
    setOrderBook({ bids: [], asks: [] });
    setRecentTrades([]);

    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('orderBook', (book: any) => setOrderBook(book));
    socket.on('recentTrades', (trades: any) => setRecentTrades(trades));
    socket.on('userOrders', (orders: any) => setUserOrders(orders));
    socket.on('balance', (bal: number) => setBalance(bal));
    socket.on('balanceUpdated', (bal: number) => setBalance(bal));
    socket.on('positions', (pos: any[]) => setPositions(pos));
    socket.on('orderUpdated', (engineOrder: any) => {
      setUserOrders((prev) => {
        const existing = prev.find((o) => o.id === engineOrder.orderId);
        const mapped = {
          id: engineOrder.orderId,
          side: engineOrder.side === 'Buy' ? 'buy' : 'sell',
          type: engineOrder.orderType,
          giftName: engineOrder.instrumentKey,
          amount: engineOrder.qty,
          filled: engineOrder.executedQty,
          price: engineOrder.price,
          status: engineOrder.status.toLowerCase(),
          time: engineOrder.createdAt,
          reduceOnly: engineOrder.reduceOnly,
          positionEffect: engineOrder.positionEffect,
          remainingQty: engineOrder.remainingQty,
          avgFillPrice: engineOrder.avgFillPrice,
          realizedPnl: engineOrder.realizedPnl,
        } as any;

        if (
          mapped.status === 'filled' ||
          mapped.status === 'cancelled' ||
          mapped.status === 'rejected'
        ) {
          return prev.filter((o) => o.id !== mapped.id);
        }
        if (existing) {
          return prev.map((o) => (o.id === mapped.id ? mapped : o));
        }
        return [mapped, ...prev];
      });
    });
    socket.on('positionUpdated', (position: any) => {
      setPositions((prev) => {
        if (position.status === 'Closed') {
          return prev.filter((p) => p.positionId !== position.positionId);
        }
        const idx = prev.findIndex((p) => p.positionId === position.positionId);
        if (idx >= 0) {
          const newPos = [...prev];
          newPos[idx] = position;
          return newPos;
        }
        return [...prev, position];
      });
    });
    socket.on('tradeHistory', (trades: any[]) => {
      setTradeHistory(trades.reverse()); // latest first
    });
    socket.on('historyUpdated', (trade: any) => {
      setTradeHistory((prev) => {
        if (prev.some((t) => t.tradeId === trade.tradeId)) return prev;
        return [trade, ...prev];
      });
    });
    socket.on('trade', (trade: Trade) => {
      setRecentTrades((prev) => [trade, ...prev].slice(0, 50));
    });

    socket.emit('subscribe', activeGift?.id || '');
    socket.emit('market_subscribe', { channel: 'gift_market', instrumentKey: activeInstrumentKey });

    return () => {
      socket.emit('market_unsubscribe', {
        channel: 'gift_market',
        instrumentKey: activeInstrumentKey,
      });
      socket.disconnect();
    };
  }, [activeGift?.id, activeInstrumentKey]);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const latestCandleRef = useRef<any>(null);

  // 1. Initialize Chart (run once)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#625d70',
      },
      grid: {
        vertLines: { color: '#2a2840' },
        horzLines: { color: '#2a2840' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: '#8b76ff', style: 3 },
        horzLine: { width: 1, color: '#8b76ff', style: 3 },
      },
      rightPriceScale: { borderColor: '#2a2840' },
      timeScale: { borderColor: '#2a2840', timeVisible: true, secondsVisible: false },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    seriesRef.current = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(() => handleResize());
    ro.observe(chartContainerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 2. Load REST Market Candles History
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    const controller = new AbortController();
    const currentConfigToken = { instrumentKey: activeInstrumentKey, timeframe };

    setChartLoading(true);
    setChartError(null);
    setIsChartEmpty(false);

    // Update timeScale options based on timeframe (e.g. show seconds for 1s)
    chartRef.current.applyOptions({
      timeScale: {
        timeVisible: true,
        secondsVisible: timeframe === '1s',
      },
    });

    fetchMarketCandles(activeInstrumentKey, timeframe, undefined, undefined, 500, controller.signal)
      .then((rawCandles) => {
        if (controller.signal.aborted) return;
        mergeRestCandles(rawCandles, currentConfigToken);
        setChartLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError' || controller.signal.aborted) return;
        console.error('Failed to fetch REST candles:', err);
        setChartError(err.message || 'Error loading market candles');
        setChartLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [activeInstrumentKey, timeframe, retryCount, mergeRestCandles]);

  // 3. Render realtime candles onto Lightweight Charts
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (realtimeChartCandles.length === 0) {
      setIsChartEmpty(true);
      seriesRef.current.setData([]);
    } else {
      setIsChartEmpty(false);
      seriesRef.current.setData(realtimeChartCandles);
      chartRef.current.timeScale().fitContent();
      latestCandleRef.current = latestChartCandle;
    }
  }, [realtimeChartCandles, latestChartCandle]);

  // 4. Synchronize realtime sales into recent trades list
  useEffect(() => {
    if (socketRecentSales.length > 0) {
      const formattedTrades: Trade[] = socketRecentSales.map((s) => ({
        id: s.id,
        giftName: s.collectionId || activeGift?.name || 'Gift',
        price: parseFloat(s.price),
        amount: typeof s.quantity === 'number' ? s.quantity : parseFloat(s.quantity || '1'),
        time: s.eventTime || Date.now(),
        takerSide: 'buy' as const,
      }));
      setRecentTrades(formattedTrades);
    }
  }, [socketRecentSales, activeGift]);

  // Margin calculations
  const usedMargin = positions
    .filter((p) => p.status === 'Open')
    .reduce((acc, p) => acc + p.qty * p.avgEntryPrice, 0);
  const totalUnrealizedPnl = positions
    .filter((p) => p.status === 'Open')
    .reduce((acc, p) => {
      const mark = p.instrumentKey === activeGift?.id ? curPrice : p.markPrice || p.avgEntryPrice;
      const pnlMultiplier = p.side === 'Long' ? 1 : -1;
      return acc + (mark - p.avgEntryPrice) * p.qty * pnlMultiplier;
    }, 0);
  const equity = balance + totalUnrealizedPnl;
  const availableBalance = equity - usedMargin;

  const activePosition = positions.find(
    (p) => p.instrumentKey === (activeGift?.id || '') && p.status === 'Open'
  );

  const submitOrder = (isClose: boolean = false) => {
    if (isSubmitting) return;
    const numericAmount = Number(amount);
    const numericPrice = orderType === 'Market' ? 0 : Number(price);

    if (!numericAmount || numericAmount <= 0) {
      setToast('Enter amount greater than 0');
      window.setTimeout(() => setToast(''), 2800);
      return;
    }

    if (orderType === 'Limit' && (!numericPrice || numericPrice <= 0)) {
      setToast('Enter valid price');
      window.setTimeout(() => setToast(''), 2800);
      return;
    }

    // Determine the actual side and reduceOnly
    let actualSide = side;
    let reduceOnly = false;

    if (activePosition) {
      if (isClose) {
        actualSide = activePosition.side === 'Long' ? 'sell' : 'buy';
        reduceOnly = true;
      } else {
        // Increasing position
        actualSide = activePosition.side === 'Long' ? 'buy' : 'sell';
      }
    } else {
      // Opening position
      actualSide = side;
    }

    if (isClose && !confirmClose) {
      setConfirmClose({
        show: true,
        side: actualSide,
        qty: numericAmount,
        price: numericPrice,
        isMarket: orderType === 'Market',
        reduceOnly,
      });
      return;
    }

    setIsSubmitting(true);
    if (socketRef.current) {
      socketRef.current.emit('placeOrder', {
        giftName: activeGift?.id || '',
        side: confirmClose ? confirmClose.side : actualSide,
        type: orderType.toLowerCase(),
        price: confirmClose ? confirmClose.price : numericPrice,
        amount: confirmClose ? confirmClose.qty : numericAmount,
        reduceOnly: confirmClose ? confirmClose.reduceOnly : reduceOnly,
      });
      setToast('Order sent');
      window.setTimeout(() => {
        setToast('');
        setIsSubmitting(false);
      }, 1500);
      setAmount('');
      setConfirmClose(null);
    } else {
      setIsSubmitting(false);
    }
  };

  const cancelOrder = (id: string) => {
    if (socketRef.current) {
      socketRef.current.emit('cancelOrder', id);
    }
  };

  const displayName = user?.first_name || 'Anonymous';
  const displayHandle = user?.username ? `@${user.username}` : 'User';
  const initials = displayName.substring(0, 2).toUpperCase();

  // Order Book max amount for depth bars
  const maxAskAmount = Math.max(...orderBook.asks.map((a) => Number(a.amount)), 1);
  const maxBidAmount = Math.max(...orderBook.bids.map((b) => Number(b.amount)), 1);

  return (
    <div className='gx-app'>
      <aside className='gx-sidebar'>
        <div className='gx-brand' onClick={() => navigate('/market')} role='button' tabIndex={0}>
          <span className='gx-brand-mark'>G</span>
          <span className='gx-brand-name'>
            Gift<span>X</span>
          </span>
        </div>
        <div className='gx-workspace-label'>{t('nav.workspace', 'Workspace')}</div>
        <nav className='gx-nav' aria-label='Main navigation'>
          <button className='gx-nav-item gx-nav-item-active' type='button'>
            <i className='material-icons'>candlestick_chart</i>
            <span>{t('nav.trade', 'Trade')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/capital')}>
            <i className='material-icons'>storefront</i>
            <span>{t('nav.gifts', 'Gifts')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/portfolio')}>
            <i className='material-icons'>card_giftcard</i>
            <span>{t('nav.portfolio', 'Portfolio')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/transactions')}>
            <i className='material-icons'>history</i>
            <span>{t('nav.activity', 'Activity')}</span>
          </button>
        </nav>
        <div className='gx-workspace-label gx-workspace-label-space'>
          {t('nav.account', 'Account')}
        </div>
        <nav className='gx-nav' aria-label='Account navigation'>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/profile')}>
            <i className='material-icons'>person_outline</i>
            <span>{t('nav.profile', 'Profile')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/dashboard')}>
            <i className='material-icons'>add_card</i>
            <span>{t('nav.deposit', 'Deposit')}</span>
          </button>
          <button
            className='gx-nav-item'
            type='button'
            onClick={() => navigate('/dashboard', { state: { tab: 'withdraw' } })}
          >
            <i className='material-icons'>output</i>
            <span>{t('nav.withdraw', 'Withdraw')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/profile')}>
            <i className='material-icons'>settings</i>
            <span>{t('nav.settings', 'Settings')}</span>
          </button>
        </nav>

        <div className='gx-sidebar-bottom'>
          <div className='gx-user-profile'>
            {user?.photo_url ? (
              <img className='gx-avatar gx-avatar-image' src={user.photo_url} alt='' />
            ) : (
              <div className='gx-avatar'>{initials}</div>
            )}
            <div>
              <strong>{displayName}</strong>
              <span>{displayHandle}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className='gx-main trade-wrapper'>
        <style>{`
          .trade-wrapper {
            --bg: #0B0D12;
            --panel: #12151C;
            --panel-2: #171B24;
            --line: #1E222C;
            --text: #E9ECF1;
            --muted: #7A8194;
            --muted-2: #4E5566;
            --up: #21D6A0;
            --up-dim: rgba(33,214,160,.10);
            --down: #FF5C7A;
            --down-dim: rgba(255,92,122,.10);
            --gold: #F2B84B;

            background: var(--bg);
            color: var(--text);
            font-family: 'Inter', sans-serif;
            -webkit-font-smoothing: antialiased;
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            overflow: hidden;
          }
          .trade-wrapper * { box-sizing: border-box; margin: 0; padding: 0; }
          .mono { font-family: 'JetBrains Mono', monospace; }

          /* ===== Top bar (slim) ===== */
          .trade-wrapper .topbar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 16px;
            border-bottom: 1px solid var(--line);
            background: linear-gradient(180deg, #0D1017, #0B0D12);
            flex: 0 0 auto;
          }
          .trade-wrapper .brand { display: flex; align-items: center; gap: 8px; }
          .trade-wrapper .brand-mark {
            width: 20px; height: 20px; border-radius: 6px;
            background: linear-gradient(135deg, var(--gold), #C98A2C);
            display: flex; align-items: center; justify-content: center; font-size: 11px;
          }
          .trade-wrapper .crumbs { font-size: 12px; color: var(--muted); display: flex; gap: 5px; align-items: center;}
          .trade-wrapper .crumbs b { color: var(--text); font-weight: 600; }
          .trade-wrapper .live-pill { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 5px; }
          .trade-wrapper .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--up); box-shadow: 0 0 6px var(--up); }

          /* ===== Market switcher ===== */
          .trade-wrapper .mkt-strip { flex: 0 0 auto; border-bottom: 1px solid var(--line); background: var(--panel); position: relative; z-index: 40; }
          .trade-wrapper .mkt-current {
            display: flex; align-items: center; gap: 12px; padding: 7px 16px; cursor: pointer; user-select: none;
          }
          .trade-wrapper .mkt-current .pn { font-size: 13px; font-weight: 700; }
          .trade-wrapper .mkt-current .pp { font-size: 13px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
          .trade-wrapper .mkt-current .pc { font-size: 11.5px; font-weight: 600; padding: 1px 6px; border-radius: 5px; }
          .trade-wrapper .mkt-current .chev {
            margin-left: auto; font-size: 10px; color: var(--muted); transition: transform .18s;
            border: 1px solid var(--line); width: 20px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center;
          }
          .trade-wrapper .mkt-strip.open .chev { transform: rotate(180deg); color: var(--gold); border-color: var(--gold); }

          /* ---- overlay + dropdown panel ---- */
          .trade-wrapper .mkt-overlay {
            position: fixed; inset: 0; background: rgba(5,6,9,.55);
            opacity: 0; pointer-events: none; transition: opacity .15s ease; z-index: 30;
          }
          .trade-wrapper .mkt-strip.open .mkt-overlay { opacity: 1; pointer-events: auto; }

          .trade-wrapper .mkt-panel {
            position: absolute; z-index: 40; top: 100%; left: 16px; width: 300px;
            background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px;
            box-shadow: 0 16px 40px rgba(0,0,0,.5);
            display: flex; flex-direction: column;
            max-height: 0; opacity: 0; overflow: hidden;
            transition: max-height .2s ease, opacity .15s ease;
          }
          .trade-wrapper .mkt-strip.open .mkt-panel { max-height: 420px; opacity: 1; margin-top: 6px; }

          .trade-wrapper .mkt-search {
            flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
            margin: 10px; padding: 8px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
          }
          .trade-wrapper .mkt-search svg { flex: 0 0 auto; opacity: .5; }
          .trade-wrapper .mkt-search input {
            flex: 1; background: none; border: none; outline: none; color: var(--text);
            font-family: 'Inter', sans-serif; font-size: 12.5px;
          }
          .trade-wrapper .mkt-search input::placeholder { color: var(--muted-2); }

          .trade-wrapper .mkt-list { flex: 1 1 auto; overflow-y: auto; padding: 0 6px 8px; max-height: 340px; }
          .trade-wrapper .mkt-list::-webkit-scrollbar { width: 5px; }
          .trade-wrapper .mkt-list::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }

          .trade-wrapper .mkt-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 10px; border-radius: 7px; cursor: pointer; transition: .1s;
          }
          .trade-wrapper .mkt-row:hover { background: var(--panel); }
          .trade-wrapper .mkt-row.active { background: rgba(242,184,75,.08); }
          .trade-wrapper .variants-list { display: flex; flex-direction: column; gap: 4px; padding: 4px 10px 10px; background: rgba(0,0,0,0.1); border-radius: 0 0 7px 7px; margin-top: -4px; margin-bottom: 4px; }
          .trade-wrapper .variant-card { display: flex; align-items: center; justify-content: space-between; padding: 6px; border-radius: 5px; cursor: pointer; transition: .1s; border: 1px solid transparent; }
          .trade-wrapper .variant-card:hover { border-color: var(--line); background: var(--panel-2); }
          .trade-wrapper .variant-card.active { background: rgba(242,184,75,.08); border-color: rgba(242,184,75,.2); }
          .trade-wrapper .variant-left { display: flex; align-items: center; gap: 8px; }
          .trade-wrapper .variant-img { width: 24px; height: 24px; border-radius: 4px; background: var(--panel); object-fit: cover; }
          .trade-wrapper .variant-info { display: flex; flex-direction: column; gap: 2px; }
          .trade-wrapper .variant-name { font-size: 11px; font-weight: 600; color: var(--text); }
          .trade-wrapper .variant-rarity { font-size: 9px; color: var(--gold); }
          .trade-wrapper .variant-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
          .trade-wrapper .variant-price { font-size: 11px; font-family: 'JetBrains Mono', monospace; font-weight: 600; }
          .trade-wrapper .mkt-row .left { display: flex; flex-direction: column; gap: 2px; }
          .trade-wrapper .mkt-row .n { font-size: 12.5px; font-weight: 600; }
          .trade-wrapper .mkt-row .vol { font-size: 10px; color: var(--muted-2); }
          .trade-wrapper .mkt-row .right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
          .trade-wrapper .mkt-row .p { font-size: 12px; font-family: 'JetBrains Mono', monospace; }
          .trade-wrapper .mkt-row .c { font-size: 10.5px; font-weight: 600; }
          .trade-wrapper .mkt-row .c.up { color: var(--up); }
          .trade-wrapper .mkt-row .c.down { color: var(--down); }
          .trade-wrapper .mkt-empty { padding: 24px 10px; text-align: center; color: var(--muted-2); font-size: 12px; }

          /* ===== Main grid: fills remaining viewport ===== */
          .trade-wrapper .layout {
            flex: 1 1 auto; display: grid;
            grid-template-columns: 1fr 220px 300px;
            gap: 1px; background: var(--line);
            min-height: 0;
          }
          .trade-wrapper .col { background: var(--bg); min-height: 0; display: flex; flex-direction: column; }

          /* ---- Chart column ---- */
          .trade-wrapper .price-head {
            flex: 0 0 auto; padding: 8px 16px; border-bottom: 1px solid var(--line);
            display: flex; align-items: baseline; gap: 14px;
          }
          .trade-wrapper .asset-price { font-size: 20px; font-weight: 700; }
          .trade-wrapper .chg-tag { font-size: 11.5px; font-weight: 600; padding: 2px 6px; border-radius: 5px; }
          .trade-wrapper .chg-up { color: var(--up); background: var(--up-dim); }
          .trade-wrapper .chg-down { color: var(--down); background: var(--down-dim); }
          .trade-wrapper .stats-inline { display: flex; gap: 16px; margin-left: auto; }
          .trade-wrapper .stat-i { font-size: 10.5px; color: var(--muted); }
          .trade-wrapper .stat-i b { color: var(--text); font-weight: 500; font-family: 'JetBrains Mono', monospace; margin-left: 3px; }

          .trade-wrapper .chart-toolbar { flex: 0 0 auto; display: flex; gap: 3px; padding: 5px 16px; border-bottom: 1px solid var(--line); }
          .trade-wrapper .tf-btn {
            background: none; border: none; color: var(--muted); font-size: 11px;
            padding: 4px 8px; border-radius: 5px; cursor: pointer; font-family: 'JetBrains Mono', monospace;
          }
          .trade-wrapper .tf-btn:hover { color: var(--text); background: var(--panel-2); }
          .trade-wrapper .tf-btn.active { color: var(--bg); background: var(--gold); font-weight: 600; }

          .trade-wrapper .chart-wrap { flex: 1 1 auto; padding: 8px 16px; min-height: 0; position: relative; }
          
          .trade-wrapper .orders-tabs { flex: 0 0 auto; display: flex; gap: 16px; padding: 6px 16px 0; border-top: 1px solid var(--line); }
          .trade-wrapper .ot { font-size: 11.5px; color: var(--muted-2); padding-bottom: 6px; cursor: pointer; position: relative; }
          .trade-wrapper .ot.active { color: var(--text); font-weight: 600; }
          .trade-wrapper .ot.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--gold); }
          .trade-wrapper .orders-empty { flex: 0 0 auto; padding: 10px 16px 12px; text-align: center; color: var(--muted); font-size: 11px; }

          /* ---- Order book column ---- */
          .trade-wrapper .ob-head { flex: 0 0 auto; padding: 8px 12px 6px; display: flex; align-items: center; justify-content: space-between; }
          .trade-wrapper .ob-title { font-size: 12px; font-weight: 700; }
          .trade-wrapper .ob-live { font-size: 9.5px; color: var(--up); display: flex; align-items: center; gap: 3px; }
          .trade-wrapper .ob-cols { flex: 0 0 auto; display: flex; justify-content: space-between; padding: 0 12px 4px; font-size: 9.5px; color: var(--muted-2); text-transform: uppercase; }
          .trade-wrapper .ob-body { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
          .trade-wrapper .ob-row { position: relative; display: flex; justify-content: space-between; padding: 1.5px 12px; font-size: 10.5px; font-family: 'JetBrains Mono', monospace; cursor: pointer; }
          .trade-wrapper .ob-row:hover { background: var(--panel); }
          .trade-wrapper .ob-row .depth { position: absolute; top: 0; bottom: 0; right: 0; z-index: 0; opacity: .14; }
          .trade-wrapper .ob-row.ask .depth { background: var(--down); }
          .trade-wrapper .ob-row.bid .depth { background: var(--up); }
          .trade-wrapper .ob-row span { position: relative; z-index: 1; }
          .trade-wrapper .ob-row .p.ask { color: var(--down); }
          .trade-wrapper .ob-row .p.bid { color: var(--up); }
          .trade-wrapper .ob-row .amt { color: var(--muted); }
          .trade-wrapper .ob-mid { flex: 0 0 auto; display: flex; align-items: baseline; gap: 8px; padding: 5px 12px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
          .trade-wrapper .ob-mid .p { font-size: 14px; font-weight: 700; color: var(--gold); font-family: 'JetBrains Mono', monospace; }
          .trade-wrapper .ob-mid .s { font-size: 9.5px; color: var(--muted); }

          /* ---- Trade form column ---- */
          .trade-wrapper .panel-inner { flex: 1 1 auto; padding: 10px 16px; display: flex; flex-direction: column; min-height: 0; }
          .trade-wrapper .side-tabs { flex: 0 0 auto; display: flex; background: var(--panel); border-radius: 7px; padding: 2px; margin-bottom: 9px; }
          .trade-wrapper .side-tab { flex: 1; text-align: center; padding: 7px 0; border-radius: 5px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--muted); }
          .trade-wrapper .side-tab.buy.active { background: var(--up-dim); color: var(--up); }
          .trade-wrapper .side-tab.sell.active { background: var(--down-dim); color: var(--down); }

          .trade-wrapper .type-row { flex: 0 0 auto; display: flex; gap: 14px; margin-bottom: 9px; border-bottom: 1px solid var(--line); padding-bottom: 7px; }
          .trade-wrapper .type-item { font-size: 11.5px; color: var(--muted-2); cursor: pointer; padding-bottom: 6px; position: relative; }
          .trade-wrapper .type-item.active { color: var(--text); font-weight: 600; }
          .trade-wrapper .type-item.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -8px; height: 2px; background: var(--gold); }

          .trade-wrapper .field {
            flex: 0 0 auto; background: var(--panel); border: 1px solid var(--line); border-radius: 7px;
            padding: 7px 10px; margin-bottom: 7px; display: flex; align-items: center; justify-content: space-between;
          }
          .trade-wrapper .field:focus-within { border-color: var(--gold); }
          .trade-wrapper .field .fl { font-size: 10px; color: var(--muted); text-transform: uppercase; }
          .trade-wrapper .field input { background: none; border: none; outline: none; color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 13px; text-align: right; width: 100%; }
          .trade-wrapper .field .unit { font-size: 11px; color: var(--muted-2); margin-left: 5px; white-space: nowrap; }

          .trade-wrapper .slider-row { flex: 0 0 auto; margin: 8px 0 10px; }
          .trade-wrapper input[type=range].pct-slider {
            -webkit-appearance: none; width: 100%; height: 3px; border-radius: 2px;
            background: linear-gradient(90deg, var(--gold) 0%, var(--gold) var(--val,0%), var(--line) var(--val,0%), var(--line) 100%);
          }
          .trade-wrapper input[type=range].pct-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--gold); border: 2px solid #0B0D12; cursor: pointer; margin-top: -4.5px; }
          .trade-wrapper .slider-marks { display: flex; justify-content: space-between; margin-top: 5px; }
          .trade-wrapper .slider-marks span { font-size: 9.5px; color: var(--muted-2); font-family: 'JetBrains Mono', monospace; cursor: pointer; }
          .trade-wrapper .slider-marks span:hover { color: var(--gold); }

          .trade-wrapper .summary { flex: 0 0 auto; margin: 4px 0 10px; }
          .trade-wrapper .sum-row { display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; color: var(--muted); }
          .trade-wrapper .sum-row b { color: var(--text); font-weight: 500; font-family: 'JetBrains Mono', monospace; }

          .trade-wrapper .cta { flex: 0 0 auto; width: 100%; border: none; padding: 11px; border-radius: 7px; font-size: 13px; font-weight: 700; cursor: pointer; margin-top: auto; }
          .trade-wrapper .cta.buy { background: var(--up); color: #062017; }
          .trade-wrapper .cta.sell { background: var(--down); color: #2a0510; }
          .trade-wrapper .cta:hover { filter: brightness(1.08); }
          
          @media (max-width: 900px) {
            .trade-wrapper .layout {
              grid-template-columns: 1fr;
              display: flex;
              flex-direction: column;
              overflow-y: auto;
            }
            .trade-wrapper .col {
              min-height: auto;
            }
            .trade-wrapper .chart-wrap {
              height: 300px;
              flex: none;
            }
          }
        `}</style>

        <div className='topbar'>
          <div className='brand' onClick={() => navigate('/market')}>
            <div className='crumbs'>
              {t('terminal.markets', 'Markets')} <span>›</span>{' '}
              <b>
                {(activeGift?.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}{' '}
                {selectedVariant ? ` / ${selectedVariant.model_name.toUpperCase()}` : ''}
              </b>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type='button'
              onClick={openLangModal}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(139, 118, 255, 0.12)',
                border: '1px solid rgba(139, 118, 255, 0.25)',
                borderRadius: '16px',
                padding: '3px 10px',
                color: '#f6f3ff',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <span>{currentLang.flag}</span>
              <span>{currentLang.code.toUpperCase()}</span>
              <i className='material-icons' style={{ fontSize: '14px', color: '#8b76ff' }}>
                arrow_drop_down
              </i>
            </button>
            <div className='live-pill'>
              <span className='dot'></span> {t('terminal.live', 'Live')}
            </div>
          </div>
        </div>

        <div className={`mkt-strip ${mktPanelOpen ? 'open' : ''}`} id='mktStrip'>
          <div className='mkt-current' onClick={() => setMktPanelOpen(!mktPanelOpen)}>
            <span className='pn'>
              {(activeGift?.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT
            </span>
            <span className='pp mono'>
              {recentTrades.length > 0
                ? formatGX(recentTrades[0].price)
                : formatGX(activeGift?.floor || 0)}
            </span>
            <span className={`pc ${(activeGift?.change || 0) >= 0 ? 'chg-up' : 'chg-down'}`}>
              {(activeGift?.change || 0) >= 0 ? '+' : ''}
              {activeGift?.change || 0}%
            </span>
            <span className='chev'>▾</span>
          </div>

          <div className='mkt-overlay' onClick={() => setMktPanelOpen(false)}></div>

          <div className='mkt-panel'>
            <div className='mkt-search'>
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <circle cx='11' cy='11' r='7'></circle>
                <line x1='21' y1='21' x2='16.65' y2='16.65'></line>
              </svg>
              <input
                type='text'
                placeholder='Поиск по названию…'
                autoComplete='off'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className='mkt-list'>
              {filteredGifts.length > 0 ? (
                filteredGifts.map((gift) => (
                  <Fragment key={gift.id}>
                    <div
                      className={`mkt-row ${gift.id === (activeGift?.id || '') ? 'active' : ''}`}
                      onClick={() => {
                        if (expandedGiftId === gift.id) {
                          setExpandedGiftId(null);
                        } else {
                          setExpandedGiftId(gift.id);
                          setGiftId(gift.id);
                          setSearchParams({ gift: gift.id });
                          setSelectedVariant(null);
                        }
                      }}
                    >
                      <div
                        className='left'
                        style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}
                      >
                        <GiftArtwork className={gift.className || ''} small emoji={gift.emoji} />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className='n'>
                            {gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT
                          </span>
                          <span className='vol'>Vol {gift.volume}</span>
                        </div>
                      </div>
                      <div className='right'>
                        <span className='p'>{formatGX(gift.floor)}</span>
                        <span className={`c ${gift.change >= 0 ? 'up' : 'down'}`}>
                          {gift.change >= 0 ? '+' : ''}
                          {gift.change}%
                        </span>
                      </div>
                    </div>
                    {expandedGiftId === gift.id && (
                      <div className='variants-list'>
                        {variantLoading ? (
                          <div style={{ fontSize: 10, color: 'var(--muted)', padding: 4 }}>
                            Загрузка дизайнов...
                          </div>
                        ) : variants.length > 0 ? (
                          variants.map((v) => (
                            <div
                              key={v.id}
                              className={`variant-card ${selectedVariant?.id === v.id ? 'active' : ''}`}
                              onClick={() => {
                                setSelectedVariant(v);
                                // We could update the chart or terminal to trade this specific variant
                                setGiftId(v.id);
                                setSearchParams({ gift: v.id });
                                setMktPanelOpen(false);
                              }}
                            >
                              <div className='variant-left'>
                                {v.image_url ? (
                                  <img src={v.image_url} alt='' className='variant-img' />
                                ) : (
                                  <div
                                    className='variant-img'
                                    style={{ background: v.backdrop_color }}
                                  />
                                )}
                                <div className='variant-info'>
                                  <span className='variant-name'>
                                    {v.model_name}{' '}
                                    {v.symbol_name !== 'None' ? `+ ${v.symbol_name}` : ''}
                                  </span>
                                  <span className='variant-rarity'>
                                    {v.rarity_percentage}% Rarity
                                  </span>
                                </div>
                              </div>
                              <div className='variant-right'>
                                <span className='variant-price'>
                                  {formatGX(v.current_price_gx)}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{ fontSize: 10, color: 'var(--muted)', padding: 4 }}>
                            Нет уникальных дизайнов
                          </div>
                        )}
                      </div>
                    )}
                  </Fragment>
                ))
              ) : (
                <div className='mkt-empty'>Ничего не найдено</div>
              )}
            </div>
          </div>
        </div>

        <div className='layout'>
          <div className='col'>
            <div className='price-head'>
              <div className='asset-price mono'>
                {recentTrades.length > 0
                  ? formatGX(recentTrades[0].price)
                  : formatGX(
                      selectedVariant ? selectedVariant.current_price_gx : activeGift?.floor || 0
                    )}
              </div>
              <span className={`chg-tag ${(activeGift?.change || 0) >= 0 ? 'chg-up' : 'chg-down'}`}>
                {(activeGift?.change || 0) >= 0 ? '+' : ''}
                {activeGift?.change || 0}%
              </span>
              <div className='stats-inline'>
                <span className='stat-i'>
                  Макс<b>{((activeGift?.floor || 0) * 1.05).toFixed(2)}</b>
                </span>
                <span className='stat-i'>
                  Мин<b>{((activeGift?.floor || 0) * 0.95).toFixed(2)}</b>
                </span>
                <span className='stat-i'>
                  Vol<b>{activeGift?.volume || ''}</b>
                </span>
              </div>
            </div>

            <div
              className='chart-toolbar'
              id='tfRow'
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', gap: '3px' }}>
                {(['1s', '1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'] as Timeframe[]).map(
                  (tf) => (
                    <button
                      key={tf}
                      type='button'
                      className={`tf-btn ${timeframe === tf ? 'active' : ''}`}
                      onClick={() => setTimeframe(tf)}
                    >
                      {tf}
                    </button>
                  )
                )}
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button
                  type='button'
                  className={`tf-btn ${selectedCurrency === 'TON' ? 'active' : ''}`}
                  onClick={() => setSelectedCurrency('TON')}
                  style={{ padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}
                >
                  TON
                </button>
                <button
                  type='button'
                  className={`tf-btn ${selectedCurrency === 'STARS' ? 'active' : ''}`}
                  onClick={() => setSelectedCurrency('STARS')}
                  style={{ padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}
                >
                  STARS
                </button>
                <div
                  title={isSocketConnected ? 'Realtime Connected' : 'Connecting Realtime...'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginLeft: '4px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.05)',
                    fontSize: '10px',
                    color: isSocketConnected ? '#10b981' : '#f59e0b',
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: isSocketConnected ? '#10b981' : '#f59e0b',
                      display: 'inline-block',
                    }}
                  />
                  <span>{isSocketConnected ? 'LIVE' : 'WAIT'}</span>
                </div>
              </div>
            </div>

            <div className='chart-wrap'>
              <div
                className='gx-chart'
                ref={chartContainerRef}
                style={{ height: '100%', width: '100%' }}
              ></div>

              {chartLoading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(11, 13, 18, 0.75)',
                    backdropFilter: 'blur(2px)',
                    color: '#E9ECF1',
                    fontSize: '13px',
                    zIndex: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(255,255,255,0.2)',
                        borderTopColor: '#F2B84B',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    <span>Загрузка истории свечей ({timeframe})...</span>
                  </div>
                </div>
              )}

              {!chartLoading && chartError && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(11, 13, 18, 0.85)',
                    color: '#FF5C7A',
                    fontSize: '13px',
                    gap: '8px',
                    zIndex: 10,
                    padding: '16px',
                    textAlign: 'center',
                  }}
                >
                  <span>Ошибка загрузки графика: {chartError}</span>
                  <button
                    type='button'
                    onClick={() => setRetryCount((r) => r + 1)}
                    style={{
                      background: 'rgba(255,92,122,0.15)',
                      border: '1px solid #FF5C7A',
                      color: '#FF5C7A',
                      padding: '4px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Повторить
                  </button>
                </div>
              )}

              {!chartLoading && !chartError && isChartEmpty && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(11, 13, 18, 0.4)',
                    color: '#7A8194',
                    fontSize: '13px',
                    zIndex: 5,
                    pointerEvents: 'none',
                  }}
                >
                  <span>Нет сделок за выбранный период ({timeframe})</span>
                </div>
              )}
            </div>

            <div className='orders-tabs'>
              <div
                className={`ot ${activityTab === 'positions' ? 'active' : ''}`}
                onClick={() => setActivityTab('positions')}
              >
                Позиции ({positions.filter((p) => p.status === 'Open').length})
              </div>
              <div
                className={`ot ${activityTab === 'open' ? 'active' : ''}`}
                onClick={() => setActivityTab('open')}
              >
                Открытые ордера ({userOrders.length})
              </div>
              <div
                className={`ot ${activityTab === 'history' ? 'active' : ''}`}
                onClick={() => setActivityTab('history')}
              >
                История
              </div>
            </div>
            <div className='orders-empty'>
              {activityTab === 'positions' ? (
                positions.filter((p) => p.status === 'Open').length === 0 ? (
                  'Нет открытых позиций'
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {positions
                      .filter((p) => p.status === 'Open')
                      .map((p) => {
                        const mark =
                          p.instrumentKey === activeGift?.id
                            ? curPrice
                            : p.markPrice || p.avgEntryPrice;
                        const pnlMultiplier = p.side === 'Long' ? 1 : -1;
                        const upnl = (mark - p.avgEntryPrice) * p.qty * pnlMultiplier;
                        return (
                          <div
                            key={p.positionId}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              padding: '8px',
                              background: 'rgba(255,255,255,0.03)',
                              borderRadius: '6px',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <span
                                style={{
                                  color: p.side === 'Long' ? '#10b981' : '#f43f5e',
                                  fontWeight: 'bold',
                                }}
                              >
                                {p.side}
                              </span>
                              <span style={{ marginLeft: '8px' }}>
                                {p.qty} {p.instrumentKey}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '11px', color: '#8b949e' }}>
                                Вход: {p.avgEntryPrice.toFixed(2)} TON
                              </span>
                              <span
                                style={{
                                  color: upnl >= 0 ? '#10b981' : '#f43f5e',
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                }}
                              >
                                {upnl > 0 ? '+' : ''}
                                {upnl.toFixed(2)} TON
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )
              ) : activityTab === 'history' ? (
                tradeHistory.length === 0 ? (
                  'История пуста'
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {tradeHistory.map((t) => (
                      <div
                        key={t.tradeId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: '6px',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <span
                            style={{
                              color: t.side === 'Buy' ? '#10b981' : '#f43f5e',
                              fontWeight: 'bold',
                            }}
                          >
                            {t.side}
                          </span>
                          <span style={{ marginLeft: '8px' }}>
                            {t.qty} {t.instrumentKey}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span>{t.price} TON</span>
                          {t.realizedPnl !== undefined && (
                            <span
                              style={{
                                color: t.realizedPnl >= 0 ? '#10b981' : '#f43f5e',
                                fontSize: '11px',
                                fontWeight: 'bold',
                              }}
                            >
                              {t.realizedPnl > 0 ? '+' : ''}
                              {t.realizedPnl.toFixed(2)} TON
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : userOrders.length === 0 ? (
                'Нет открытых ордеров'
              ) : (
                userOrders.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '4px 0',
                      borderBottom: '1px solid #1E222C',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      {o.side === 'buy' ? 'Покупка' : 'Продажа'} {o.amount} {o.giftName}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span>{o.price} TON</span>
                      {o.status === 'open' && (
                        <button
                          onClick={() => cancelOrder(o.id)}
                          style={{
                            background: '#2C313C',
                            border: 'none',
                            color: '#FFF',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                          }}
                        >
                          Отменить
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className='col'>
            <div className='ob-head'>
              <div className='ob-title'>Стакан</div>
              <div className='ob-live'>
                <span className='dot'></span>Live
              </div>
            </div>
            <div className='ob-cols'>
              <span>Цена</span>
              <span>Кол-во</span>
            </div>
            <div className='ob-body'>
              <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
                {orderBook.asks.slice(0, 15).map((ask) => {
                  const depthPercent = (Number(ask.amount) / maxAskAmount) * 100;
                  return (
                    <div
                      className='ob-row ask'
                      key={ask.price}
                      onClick={() => setPrice(ask.price.toString())}
                    >
                      <div className='depth' style={{ width: `${depthPercent}%` }}></div>
                      <span className='p ask'>{ask.price}</span>
                      <span className='amt'>{ask.amount}</span>
                    </div>
                  );
                })}
              </div>
              <div className='ob-mid'>
                <span className='p'>
                  {recentTrades.length > 0
                    ? formatGX(recentTrades[0].price)
                    : formatGX(activeGift?.floor || 0)}
                </span>
                <span className='s'>
                  Спред{' '}
                  {orderBook.asks.length && orderBook.bids.length
                    ? (Number(orderBook.asks[0].price) - Number(orderBook.bids[0].price)).toFixed(2)
                    : '-'}
                </span>
              </div>
              <div>
                {orderBook.bids.slice(0, 15).map((bid) => {
                  const depthPercent = (Number(bid.amount) / maxBidAmount) * 100;
                  return (
                    <div
                      className='ob-row bid'
                      key={bid.price}
                      onClick={() => setPrice(bid.price.toString())}
                    >
                      <div className='depth' style={{ width: `${depthPercent}%` }}></div>
                      <span className='p bid'>{bid.price}</span>
                      <span className='amt'>{bid.amount}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className='col'>
            <div className='panel-inner'>
              {(() => {
                const activePosition = positions.find(
                  (p) => p.instrumentKey === (activeGift?.id || '') && p.status === 'Open'
                );
                const curPrice = recentTrades[0]?.price || activeGift?.floor || 0;
                const markPrice = activePosition ? activePosition.markPrice || curPrice : curPrice;

                if (confirmClose) {
                  const expectedPnl =
                    confirmClose.side === 'sell'
                      ? (confirmClose.isMarket ? curPrice : confirmClose.price) -
                        (activePosition?.avgEntryPrice || 0)
                      : (activePosition?.avgEntryPrice || 0) -
                        (confirmClose.isMarket ? curPrice : confirmClose.price);
                  const totalPnl = expectedPnl * confirmClose.qty;

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <h3 style={{ margin: 0, fontSize: '16px', color: '#FFF' }}>
                        Подтверждение закрытия
                      </h3>
                      <div className='summary' style={{ marginTop: 0 }}>
                        <div className='sum-row'>
                          <span>Направление</span>
                          <b
                            style={{ color: confirmClose.side === 'sell' ? '#f43f5e' : '#10b981' }}
                          >
                            {activePosition?.side}
                          </b>
                        </div>
                        <div className='sum-row'>
                          <span>Количество</span>
                          <b>{confirmClose.qty}</b>
                        </div>
                        <div className='sum-row'>
                          <span>Цена входа</span>
                          <b>{activePosition?.avgEntryPrice?.toFixed(2)} TON</b>
                        </div>
                        <div className='sum-row'>
                          <span>Текущая цена</span>
                          <b>{curPrice.toFixed(2)} TON</b>
                        </div>
                        <div className='sum-row'>
                          <span>Ожидаемый PnL</span>
                          <b style={{ color: totalPnl >= 0 ? '#10b981' : '#f43f5e' }}>
                            {totalPnl > 0 ? '+' : ''}
                            {totalPnl.toFixed(2)} TON
                          </b>
                        </div>
                        <div className='sum-row'>
                          <span>Комиссия</span>
                          <b>0.25%</b>
                        </div>
                      </div>
                      {confirmClose.isMarket && (
                        <div
                          style={{
                            color: '#FFB020',
                            fontSize: '12px',
                            background: 'rgba(255,176,32,0.1)',
                            padding: '8px',
                            borderRadius: '4px',
                          }}
                        >
                          Внимание: Рыночный ордер может исполниться по цене, отличающейся от
                          текущей!
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <button
                          className='cta'
                          style={{ background: '#2C313C', flex: 1 }}
                          onClick={() => setConfirmClose(null)}
                          disabled={isSubmitting}
                        >
                          Отмена
                        </button>
                        <button
                          className={`cta ${confirmClose.side}`}
                          style={{ flex: 1 }}
                          onClick={() => submitOrder(true)}
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? '...' : 'Подтвердить'}
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <>
                    {!activePosition ? (
                      <div className='side-tabs'>
                        <div
                          className={`side-tab buy ${side === 'buy' ? 'active' : ''}`}
                          onClick={() => setSide('buy')}
                        >
                          Открыть Long
                        </div>
                        <div
                          className={`side-tab sell ${side === 'sell' ? 'active' : ''}`}
                          onClick={() => setSide('sell')}
                        >
                          Открыть Short
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          marginBottom: '16px',
                          background: 'rgba(255,255,255,0.03)',
                          padding: '12px',
                          borderRadius: '8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: '#8b96a8', fontSize: '13px' }}>
                            Текущая позиция
                          </span>
                          <span
                            style={{
                              color: activePosition.side === 'Long' ? '#10b981' : '#f43f5e',
                              fontWeight: 'bold',
                            }}
                          >
                            {activePosition.side}
                          </span>
                        </div>
                        <div
                          className='summary'
                          style={{ marginTop: 0, padding: 0, background: 'transparent' }}
                        >
                          <div className='sum-row'>
                            <span>Количество</span>
                            <b>{activePosition.qty}</b>
                          </div>
                          <div className='sum-row'>
                            <span>Вход</span>
                            <b>{activePosition.avgEntryPrice?.toFixed(2)} TON</b>
                          </div>
                          <div className='sum-row'>
                            <span>Текущая</span>
                            <b>{markPrice.toFixed(2)} TON</b>
                          </div>
                          {(() => {
                            const dynamicPnl =
                              activePosition.side === 'Long'
                                ? (curPrice - activePosition.avgEntryPrice) * activePosition.qty
                                : (activePosition.avgEntryPrice - curPrice) * activePosition.qty;
                            const pnlPct =
                              (dynamicPnl / (activePosition.avgEntryPrice * activePosition.qty)) *
                              100;
                            return (
                              <div className='sum-row'>
                                <span>Unrealized PnL</span>
                                <b style={{ color: dynamicPnl >= 0 ? '#10b981' : '#f43f5e' }}>
                                  {dynamicPnl > 0 ? '+' : ''}
                                  {dynamicPnl.toFixed(2)} TON ({pnlPct.toFixed(2)}%)
                                </b>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    <div className='type-row'>
                      <div
                        className={`type-item ${orderType === 'Limit' ? 'active' : ''}`}
                        onClick={() => setOrderType('Limit')}
                      >
                        Лимит
                      </div>
                      <div
                        className={`type-item ${orderType === 'Market' ? 'active' : ''}`}
                        onClick={() => setOrderType('Market')}
                      >
                        Рынок
                      </div>
                    </div>

                    <div
                      className='field'
                      style={{
                        opacity: orderType === 'Market' ? 0.4 : 1,
                        pointerEvents: orderType === 'Market' ? 'none' : 'auto',
                      }}
                    >
                      <span className='fl'>Цена</span>
                      <input
                        type='text'
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        disabled={orderType === 'Market'}
                        inputMode='decimal'
                      />
                      <span className='unit'>{selectedCurrency}</span>
                    </div>
                    <div className='field'>
                      <span className='fl'>Кол-во</span>
                      <input
                        type='text'
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        inputMode='decimal'
                      />
                      <span className='unit'>GIFT</span>
                    </div>

                    <div className='slider-row'>
                      <input
                        type='range'
                        className='pct-slider'
                        min='0'
                        max='100'
                        step='25'
                        value={
                          amount && price
                            ? Math.min(
                                100,
                                Math.floor(
                                  (Number(amount) /
                                    (!activePosition
                                      ? side === 'buy'
                                        ? balance / (Number(price) || curPrice)
                                        : 100
                                      : activePosition.qty)) *
                                    100
                                )
                              )
                            : 0
                        }
                        onChange={(e) => {
                          const percent = Number(e.target.value);
                          if (!activePosition) {
                            if (side === 'buy') {
                              const curP = orderType === 'Limit' ? Number(price) : curPrice;
                              if (curP > 0) {
                                const maxShares = balance / curP;
                                setAmount(Math.floor(maxShares * (percent / 100)).toString());
                              }
                            } else {
                              setAmount(Math.floor(100 * (percent / 100)).toString()); // Arbitrary for shorting
                            }
                          } else {
                            setAmount(Math.floor(activePosition.qty * (percent / 100)).toString());
                          }
                        }}
                      />
                      <div className='slider-marks'>
                        {[0, 25, 50, 75, 100].map((p) => (
                          <span
                            key={p}
                            onClick={() => {
                              const percent = p;
                              if (!activePosition) {
                                if (side === 'buy') {
                                  const curP = orderType === 'Limit' ? Number(price) : curPrice;
                                  if (curP > 0) {
                                    const maxShares = balance / curP;
                                    setAmount(Math.floor(maxShares * (percent / 100)).toString());
                                  }
                                } else {
                                  setAmount(Math.floor(100 * (percent / 100)).toString());
                                }
                              } else {
                                setAmount(
                                  Math.floor(activePosition.qty * (percent / 100)).toString()
                                );
                              }
                            }}
                          >
                            {p === 0 ? '0' : `${p}%`}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className='summary'>
                      <div className='sum-row'>
                        <span>Баланс</span>
                        <b>{formatGX(balance)} TON</b>
                      </div>
                      <div className='sum-row'>
                        <span>Доступно</span>
                        <b>
                          {!activePosition
                            ? formatGX(availableBalance) + ' TON'
                            : activePosition.qty + ' GIFT'}
                        </b>
                      </div>
                      <div className='sum-row'>
                        <span>Комиссия</span>
                        <b>0.25%</b>
                      </div>
                      <div className='sum-row'>
                        <span>Итого</span>
                        <b>{formatGX((Number(price) || curPrice) * (Number(amount) || 0))} TON</b>
                      </div>
                    </div>

                    {!activePosition ? (
                      <button
                        className={`cta ${side}`}
                        onClick={() => submitOrder(false)}
                        disabled={isSubmitting}
                      >
                        {side === 'buy' ? 'Открыть Long' : 'Открыть Short'}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className={`cta ${activePosition.side === 'Long' ? 'buy' : 'sell'}`}
                          style={{ flex: 1, opacity: 0.8 }}
                          onClick={() => submitOrder(false)}
                          disabled={isSubmitting}
                        >
                          {activePosition.side === 'Long' ? 'Увеличить Long' : 'Увеличить Short'}
                        </button>
                        <button
                          className={`cta ${activePosition.side === 'Long' ? 'sell' : 'buy'}`}
                          style={{ flex: 1 }}
                          onClick={() => submitOrder(true)}
                          disabled={isSubmitting}
                        >
                          {activePosition.side === 'Long' ? 'Закрыть Long' : 'Выкупить Short'}
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div className='gx-toast'>
          <i className='material-icons'>check_circle</i>
          {toast}
        </div>
      )}
    </div>
  );
};

export default GXTerminalScreen;
