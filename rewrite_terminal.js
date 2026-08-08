const fs = require('fs');

const code = `import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { io, Socket } from 'socket.io-client';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { formatGX, gifts } from '../../data/gifts';

type OpenOrder = {
  id: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
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

const MOCK_BALANCE = 12480.50;

function GiftArtwork({ className, small }: { className: string; small?: boolean }) {
  return (
    <div className={\`gx-gift-artwork \${className} \${small ? 'is-small' : ''}\`}>
      <div className='gx-gift-box' />
    </div>
  );
}

const GXTerminalScreen = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const giftId = searchParams.get('gift') || 'durov-cap';
  const { isTelegram, user } = useTelegramWebApp();

  const activeGift = useMemo(() => gifts.find((g) => g.id === giftId) || gifts[0], [giftId]);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'Limit' | 'Market'>('Limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState(activeGift.floor.toFixed(2));
  const [toast, setToast] = useState('');
  
  const [activityTab, setActivityTab] = useState<'open'|'history'|'trades'>('open');

  const [orderBook, setOrderBook] = useState<{bids: any[], asks: any[]}>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [userOrders, setUserOrders] = useState<OpenOrder[]>([]);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Reset price when gift changes
    setPrice(activeGift.floor.toFixed(2));
    setOrderBook({ bids: [], asks: [] });
    setRecentTrades([]);
    
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('orderBook', (book) => setOrderBook(book));
    socket.on('recentTrades', (trades) => setRecentTrades(trades));
    socket.on('userOrders', (orders) => setUserOrders(orders));
    socket.on('trade', (trade: Trade) => {
      setRecentTrades(prev => [trade, ...prev].slice(0, 50));
    });

    socket.emit('subscribe', activeGift.name);

    return () => {
      socket.disconnect();
    };
  }, [activeGift.id, activeGift.floor, activeGift.name]);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

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

    const candlestickSeries = (chart as any).addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    seriesRef.current = candlestickSeries;

    const generateData = () => {
      const data = [];
      let currentPrice = activeGift.floor * 0.9;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const startTime = now.getTime() / 1000;
      
      for (let i = 0; i < 60; i++) {
        const open = currentPrice;
        const close = open + (Math.random() - 0.45) * 5;
        const high = Math.max(open, close) + Math.random() * 2;
        const low = Math.min(open, close) - Math.random() * 2;
        
        data.push({
          time: startTime + (i * 3600),
          open, high, low, close,
        });
        currentPrice = close;
      }
      
      const last = data[data.length - 1];
      last.close = activeGift.floor;
      last.high = Math.max(last.high, activeGift.floor);
      last.low = Math.min(last.low, activeGift.floor);
      
      return data;
    };

    candlestickSeries.setData(generateData());
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [activeGift.floor]);

  // Update chart when new trades happen (very simple simulation of candle updating)
  useEffect(() => {
    if (recentTrades.length > 0 && seriesRef.current) {
      const latestTrade = recentTrades[0];
      // Note: A real app would update the current candle
    }
  }, [recentTrades]);

  const submitOrder = () => {
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

    if (socketRef.current) {
      socketRef.current.emit('placeOrder', {
        giftName: activeGift.name,
        side,
        type: orderType.toLowerCase(),
        price: numericPrice,
        amount: numericAmount
      });
      setToast(\`\${side.toUpperCase()} \${orderType} order sent\`);
      window.setTimeout(() => setToast(''), 2800);
      setAmount('');
    }
  };

  const cancelOrder = (id: string) => {
    if (socketRef.current) {
      socketRef.current.emit('cancelOrder', id);
    }
  };

  const displayName = user?.first_name || 'Anonymous';
  const displayHandle = user?.username ? \`@\${user.username}\` : 'User';
  const initials = displayName.substring(0, 2).toUpperCase();

  // Order Book max amount for depth bars
  const maxAskAmount = Math.max(...orderBook.asks.map(a => Number(a.amount)), 1);
  const maxBidAmount = Math.max(...orderBook.bids.map(b => Number(b.amount)), 1);

  return (
    <div className='gx-app'>
      <aside className='gx-sidebar'>
        <div className='gx-brand' onClick={() => navigate('/market')} role='button' tabIndex={0}>
          <span className='gx-brand-mark'>G</span>
          <span className='gx-brand-name'>Gift<span>X</span></span>
        </div>
        <div className='gx-workspace-label'>Workspace</div>
        <nav className='gx-nav' aria-label='Main navigation'>
          <button className='gx-nav-item gx-nav-item-active' type='button'>
            <i className='material-icons'>candlestick_chart</i>
            <span>Trade</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/capital')}>
            <i className='material-icons'>storefront</i>
            <span>Gifts</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/portfolio')}>
            <i className='material-icons'>card_giftcard</i>
            <span>Portfolio</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/transactions')}>
            <i className='material-icons'>history</i>
            <span>Activity</span>
          </button>
        </nav>
        <div className='gx-workspace-label gx-workspace-label-space'>Account</div>
        <nav className='gx-nav' aria-label='Account navigation'>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/profile')}>
            <i className='material-icons'>person_outline</i>
            <span>Profile</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/dashboard')}>
            <i className='material-icons'>add_card</i>
            <span>Deposit</span>
          </button>
          <button
            className='gx-nav-item'
            type='button'
            onClick={() => navigate('/dashboard', { state: { tab: 'withdraw' } })}
          >
            <i className='material-icons'>output</i>
            <span>Withdraw</span>
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
      
      <main className='gx-main'>
        <header className='gx-topbar'>
          <div className='gx-breadcrumb'>
            <span>Markets</span>
            <i className='material-icons'>chevron_right</i>
            <strong>{activeGift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT</strong>
          </div>
          <div className='gx-top-actions'>
            <span className='gx-live-pill'>
              <span /> {isTelegram ? 'Telegram Mini App' : 'Browser preview'}
            </span>
          </div>
        </header>
        <section className='gx-terminal'>
          <div className='gx-left-column'>
            <div className='gx-panel gx-markets-panel'>
              <div className='gx-panel-header'>
                <div>
                  <span className='gx-panel-kicker'>EXPLORE</span>
                  <h2>Markets</h2>
                </div>
              </div>
              <div className='gx-market-list'>
                {gifts.map((gift) => (
                  <button
                    type='button'
                    key={gift.id}
                    className={\`gx-market-row \${activeGift.id === gift.id ? 'is-active' : ''}\`}
                    onClick={() => navigate(\`/terminal?gift=\${gift.id}\`)}
                  >
                    <GiftArtwork className={gift.className} small />
                    <div className='gx-row-details'>
                      <strong>{gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT</strong>
                      <span className='gx-positive'>+{gift.change}%</span>
                    </div>
                    <div className='gx-row-price'>
                      <strong>{formatGX(gift.floor)}</strong>
                      <span>Vol {gift.volume}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          <div className='gx-center-column'>
            <div className='gx-panel gx-chart-panel'>
              <div className='gx-chart-heading'>
                <div className='gx-selected-gift'>
                  <GiftArtwork className={activeGift.className} small />
                  <div>
                    <h2>
                      {activeGift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT <span>/ GX</span>
                    </h2>
                    <small>Telegram Gifts · {activeGift.rarity}</small>
                  </div>
                </div>
                <div className='gx-chart-price'>
                  <strong>{recentTrades.length > 0 ? formatGX(recentTrades[0].price) : formatGX(activeGift.floor)}</strong>
                  <span className='gx-positive'>+{activeGift.change}%</span>
                </div>
              </div>
              
              <div className='gx-chart' ref={chartContainerRef} style={{ height: '300px', width: '100%', padding: '0 12px' }}>
              </div>
              
            </div>
            
            <div className='gx-panel gx-orders-panel' style={{ flex: 1, minHeight: 250 }}>
              <div className='gx-panel-header gx-orders-title'>
                <div className="gx-order-tabs" style={{ margin: 0 }}>
                  <button type="button" className={activityTab === 'open' ? 'is-active' : ''} onClick={() => setActivityTab('open')}>Open Orders</button>
                  <button type="button" className={activityTab === 'history' ? 'is-active' : ''} onClick={() => setActivityTab('history')}>Order History</button>
                  <button type="button" className={activityTab === 'trades' ? 'is-active' : ''} onClick={() => setActivityTab('trades')}>Trade History</button>
                </div>
              </div>
              
              <div style={{ padding: '0 16px 16px', overflowY: 'auto' }}>
                {activityTab === 'open' && (
                  userOrders.filter(o => o.status === 'open').length === 0 ? (
                    <div className='gx-empty-orders'>
                      <div className='gx-empty-icon'><i className='material-icons'>receipt_long</i></div>
                      <strong>No open orders</strong>
                      <span>Your active orders will appear here.</span>
                    </div>
                  ) : (
                    <div className='gx-open-orders'>
                      {userOrders.filter(o => o.status === 'open').map((order) => (
                        <div className='gx-open-order' key={order.id}>
                          <span className={order.side === 'buy' ? 'gx-positive' : 'gx-negative'}>
                            {order.side.toUpperCase()}
                          </span>
                          <span>
                            <strong>{order.type.toUpperCase()}</strong>
                            <small>{order.amount} shares</small>
                          </span>
                          <span className='gx-open-order-price'>
                            <strong>{order.type === 'market' ? 'MARKET' : \`\${formatGX(order.price)} GX\`}</strong>
                            <small>{order.filled} filled</small>
                          </span>
                          <button
                            type='button'
                            onClick={() => cancelOrder(order.id)}
                            style={{ padding: '6px 12px', background: '#2a2840', borderRadius: '6px', color: '#f6f3ff', cursor: 'pointer', border: 'none' }}
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                )}
                
                {activityTab === 'history' && (
                  userOrders.filter(o => o.status !== 'open').length === 0 ? (
                    <div className='gx-empty-orders'>
                      <strong>No order history</strong>
                    </div>
                  ) : (
                    <div className='gx-open-orders'>
                      {userOrders.filter(o => o.status !== 'open').map((order) => (
                        <div className='gx-open-order' key={order.id} style={{ opacity: 0.7 }}>
                          <span className={order.side === 'buy' ? 'gx-positive' : 'gx-negative'}>
                            {order.side.toUpperCase()}
                          </span>
                          <span>
                            <strong>{order.type.toUpperCase()}</strong>
                            <small>{order.amount} shares</small>
                          </span>
                          <span>
                            <strong>{order.status.toUpperCase()}</strong>
                            <small>{order.filled} filled</small>
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                )}
                
                {activityTab === 'trades' && (
                  recentTrades.length === 0 ? (
                    <div className='gx-empty-orders'>
                      <strong>No recent trades</strong>
                    </div>
                  ) : (
                    <div className='gx-open-orders'>
                      {recentTrades.map((trade) => (
                        <div className='gx-open-order' key={trade.id}>
                          <span className={trade.takerSide === 'buy' ? 'gx-positive' : 'gx-negative'}>
                            {formatGX(trade.price)}
                          </span>
                          <span>{trade.amount}</span>
                          <span>{new Date(trade.time).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
          
          <aside className='gx-right-column'>
            <div className='gx-panel gx-orderbook-panel' style={{ flex: 1, minHeight: 300 }}>
              <div className='gx-panel-header' style={{ paddingBottom: 8 }}>
                <div>
                  <span className='gx-panel-kicker'>LIVE DATA</span>
                  <h2>Order book</h2>
                </div>
                <span className='gx-live-dot'>● Live</span>
              </div>
              <div className='gx-book-head'>
                <span>Price (GX)</span>
                <span>Amount</span>
                <span>Total</span>
              </div>
              
              <div className='gx-book-rows gx-sells' style={{ display: 'flex', flexDirection: 'column-reverse', flex: 1, overflowY: 'hidden', minHeight: 120 }}>
                {orderBook.asks.slice(0, 15).map((ask) => {
                  const total = (Number(ask.price) * Number(ask.amount)).toFixed(2);
                  const depthPercent = (Number(ask.amount) / maxAskAmount) * 100;
                  return (
                    <div className='gx-book-row' key={ask.price} onClick={() => setPrice(ask.price.toString())} style={{ cursor: 'pointer', position: 'relative' }}>
                      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: \`\${depthPercent}%\`, backgroundColor: 'rgba(244, 63, 94, 0.1)', zIndex: 0 }} />
                      <span style={{ zIndex: 1, color: '#f43f5e' }}>{ask.price}</span>
                      <span style={{ zIndex: 1 }}>{ask.amount}</span>
                      <span style={{ zIndex: 1 }}>{total}</span>
                    </div>
                  );
                })}
              </div>
              
              <div className='gx-book-mid' style={{ padding: '8px 16px', background: '#161425', borderTop: '1px solid #2a2840', borderBottom: '1px solid #2a2840' }}>
                <strong style={{ fontSize: 16 }}>{recentTrades.length > 0 ? formatGX(recentTrades[0].price) : formatGX(activeGift.floor)}</strong>
                {orderBook.asks.length > 0 && orderBook.bids.length > 0 ? (
                  <span style={{ fontSize: 12, color: '#625d70' }}>Spread: {(Number(orderBook.asks[0].price) - Number(orderBook.bids[0].price)).toFixed(2)} GX</span>
                ) : <span>Spread: -</span>}
              </div>
              
              <div className='gx-book-rows gx-buys' style={{ flex: 1, overflowY: 'hidden', minHeight: 120 }}>
                {orderBook.bids.slice(0, 15).map((bid) => {
                  const total = (Number(bid.price) * Number(bid.amount)).toFixed(2);
                  const depthPercent = (Number(bid.amount) / maxBidAmount) * 100;
                  return (
                    <div className='gx-book-row' key={bid.price} onClick={() => setPrice(bid.price.toString())} style={{ cursor: 'pointer', position: 'relative' }}>
                      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: \`\${depthPercent}%\`, backgroundColor: 'rgba(16, 185, 129, 0.1)', zIndex: 0 }} />
                      <span style={{ zIndex: 1, color: '#10b981' }}>{bid.price}</span>
                      <span style={{ zIndex: 1 }}>{bid.amount}</span>
                      <span style={{ zIndex: 1 }}>{total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          
            <div className='gx-panel gx-order-panel'>
              <div className='gx-order-tabs'>
                <button type='button' className={side === 'buy' ? 'is-buy' : ''} onClick={() => setSide('buy')}>Buy</button>
                <button type='button' className={side === 'sell' ? 'is-sell' : ''} onClick={() => setSide('sell')}>Sell</button>
              </div>
              
              <div className='gx-order-type'>
                {['Limit', 'Market'].map((type) => (
                  <button
                    type='button'
                    key={type}
                    className={orderType === type ? 'is-active' : ''}
                    onClick={() => setOrderType(type as 'Limit' | 'Market')}
                  >
                    {type}
                  </button>
                ))}
              </div>
              
              {orderType === 'Limit' && (
                <label className='gx-input-label'>
                  Price <span>GX</span>
                  <div className='gx-order-input'>
                    <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode='decimal' />
                    <span>GX</span>
                  </div>
                </label>
              )}
              
              <label className='gx-input-label'>
                Amount <span>SHARES</span>
                <div className='gx-order-input'>
                  <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode='decimal' placeholder="0" />
                  <span>SHARES</span>
                </div>
              </label>
              
              <div className='gx-percent-row'>
                {[25, 50, 75, 100].map((percent) => (
                  <button
                    type='button'
                    key={percent}
                    onClick={() => {
                      if (side === 'buy') {
                        // Max buy amount based on balance and price
                        const curPrice = orderType === 'Limit' ? Number(price) : (recentTrades[0]?.price || activeGift.floor);
                        if (curPrice > 0) {
                          const maxShares = MOCK_BALANCE / curPrice;
                          setAmount(Math.floor(maxShares * (percent / 100)).toString());
                        }
                      } else {
                        // Max sell amount based on inventory (mocking 100 shares for demo)
                        setAmount(Math.floor(100 * (percent / 100)).toString());
                      }
                    }}
                  >
                    {percent}%
                  </button>
                ))}
              </div>
              
              <div className='gx-order-summary'>
                <span>Available <b>{formatGX(MOCK_BALANCE)} GX</b></span>
                <span>Fee <b>0.25%</b></span>
                {orderType === 'Limit' ? (
                  <span>Total <strong>{formatGX(Number(price) * (Number(amount) || 0))} GX</strong></span>
                ) : (
                  <span>Total <strong>≈ {formatGX((recentTrades[0]?.price || activeGift.floor) * (Number(amount) || 0))} GX</strong></span>
                )}
              </div>
              
              <button
                type='button'
                className={\`gx-submit \${side === 'sell' ? 'gx-submit-sell' : ''}\`}
                onClick={submitOrder}
              >
                {side === 'buy' ? 'Buy' : 'Sell'} {activeGift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}
                <i className='material-icons'>arrow_forward</i>
              </button>
            </div>
          </aside>
        </section>
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
`;

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
