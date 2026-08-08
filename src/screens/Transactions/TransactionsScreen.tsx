import { useNavigate } from 'react-router-dom';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { formatGX } from '../../data/gifts';
import { useGifts } from '../../context/GiftsContext';

const mockOrders = [
  {
    id: 1,
    side: 'buy' as const,
    gift: "Durov's Cap",
    amount: 200,
    price: 124.8,
    total: 249.6,
    date: 'Today, 14:32',
    status: 'filled',
  },
  {
    id: 2,
    side: 'sell' as const,
    gift: 'Berry Box',
    amount: 100,
    price: 86.2,
    total: 86.2,
    date: 'Today, 11:05',
    status: 'filled',
  },
  {
    id: 3,
    side: 'buy' as const,
    gift: 'Signet Ring',
    amount: 300,
    price: 58.9,
    total: 176.7,
    date: 'Yesterday, 19:48',
    status: 'filled',
  },
  {
    id: 4,
    side: 'sell' as const,
    gift: 'Diamond Ring',
    amount: 100,
    price: 312.5,
    total: 312.5,
    date: 'Yesterday, 09:21',
    status: 'cancelled',
  },
  {
    id: 5,
    side: 'buy' as const,
    gift: 'Lol Pop',
    amount: 500,
    price: 31.4,
    total: 157.0,
    date: 'Jun 28, 16:10',
    status: 'filled',
  },
  {
    id: 6,
    side: 'buy' as const,
    gift: 'Genie Lamp',
    amount: 100,
    price: 640.0,
    total: 640.0,
    date: 'Jun 27, 08:55',
    status: 'filled',
  },
];

const TransactionsScreen: React.FC = () => {
  const { gifts, loading } = useGifts();
  const navigate = useNavigate();
  const { isTelegram, user } = useTelegramWebApp();
  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Alex Smith';
  const displayHandle = user?.username ? `@${user.username}` : 'alexsmith.tg';
  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : 'AS';

  const filledCount = mockOrders.filter((o) => o.status === 'filled').length;
  const totalVolume = mockOrders
    .filter((o) => o.status === 'filled')
    .reduce((s, o) => s + o.total, 0);

  return (
    <div className='gx-app'>
      <aside className='gx-sidebar'>
        <div className='gx-brand' onClick={() => navigate('/market')} role='button' tabIndex={0}>
          <span className='gx-brand-mark'>G</span>
          <span className='gx-brand-name'>
            Gift<span>X</span>
          </span>
        </div>
        <div className='gx-workspace-label'>Workspace</div>
        <nav className='gx-nav' aria-label='Main navigation'>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/market')}>
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
          <button className='gx-nav-item gx-nav-item-active' type='button'>
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
          <button className='gx-nav-item' type='button' onClick={() => navigate('/profile')}>
            <i className='material-icons'>settings</i>
            <span>Settings</span>
          </button>
        </nav>
        <div className='gx-sidebar-bottom'>
          <div className='gx-status'>
            <span className='gx-status-dot' /> All systems operational
          </div>
          <button className='gx-help-button' type='button'>
            <i className='material-icons'>help_outline</i> Help center <span>↗</span>
          </button>
          <div className='gx-user-mini'>
            {user?.photo_url ? (
              <img className='gx-avatar gx-avatar-image' src={user.photo_url} alt='' />
            ) : (
              <div className='gx-avatar'>{initials}</div>
            )}
            <div>
              <strong>{displayName}</strong>
              <span>{displayHandle}</span>
            </div>
            <i className='material-icons'>more_horiz</i>
          </div>
        </div>
      </aside>

      <main className='gx-main'>
        <header className='gx-topbar'>
          <div className='gx-breadcrumb'>
            <span>Account</span>
            <i className='material-icons'>chevron_right</i>
            <strong>Activity</strong>
          </div>
          <div className='gx-top-actions'>
            <span className='gx-live-pill'>
              <span /> {isTelegram ? 'Telegram Mini App' : 'Browser preview'}
            </span>
            <button
              type='button'
              className='gx-icon-button'
              aria-label='Search'
              onClick={() => navigate('/capital')}
            >
              <i className='material-icons'>search</i>
            </button>
            <button
              type='button'
              className='gx-icon-button'
              aria-label='Notifications'
              onClick={(e) => {
                e.currentTarget.querySelector('em')?.remove();
              }}
            >
              <i className='material-icons'>notifications_none</i>
              <em>3</em>
            </button>
            {user?.photo_url ? (
              <img
                className='gx-top-avatar gx-avatar-image'
                src={user.photo_url}
                alt={displayName}
                onClick={() => navigate('/profile')}
                style={{ cursor: 'pointer' }}
              />
            ) : (
              <button
                type='button'
                className='gx-top-avatar'
                onClick={() => navigate('/profile')}
                style={{ cursor: 'pointer' }}
              >
                {initials}
              </button>
            )}
          </div>
        </header>

        <section className='gx-page-heading'>
          <div>
            <p className='gx-eyebrow'>
              ACTIVITY <span className='gx-heading-line' />
            </p>
            <h1>Order history</h1>
            <p className='gx-subheading'>All your completed and cancelled gift trades.</p>
          </div>
          <div className='gx-balance'>
            <span>Total traded</span>
            <strong>
              {formatGX(totalVolume)} <small>GX</small>
            </strong>
            <button type='button' onClick={() => navigate('/market')}>
              <i className='material-icons'>candlestick_chart</i> Trade now
            </button>
          </div>
        </section>

        <section className='gx-market-stats'>
          <div>
            <span>Filled orders</span>
            <strong>{filledCount}</strong>
            <em className='gx-positive'>of {mockOrders.length} total</em>
          </div>
          <div>
            <span>Total volume</span>
            <strong>
              {formatGX(totalVolume)} <small>GX</small>
            </strong>
            <em>lifetime</em>
          </div>
          <div>
            <span>Best trade</span>
            <strong>Genie Lamp</strong>
            <em>640.00 GX</em>
          </div>
          <div>
            <span>Avg fee paid</span>
            <strong>0.25%</strong>
            <em>per order</em>
          </div>
        </section>

        <section className='gx-panel' style={{ margin: '0 28px 28px' }}>
          <div className='gx-panel-header'>
            <div>
              <span className='gx-panel-kicker'>HISTORY</span>
              <h2>
                All orders <small>{mockOrders.length} records</small>
              </h2>
            </div>
            <button type='button' className='gx-more-button' onClick={() => navigate('/market')}>
              New trade <i className='material-icons'>arrow_forward</i>
            </button>
          </div>

          <div className='gx-activity-table' style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              className='gx-activity-head'
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 2fr 1fr 1.5fr 1.5fr 1.5fr 1fr',
                padding: '12px 20px',
                color: '#625d70',
                fontSize: '12px',
                borderBottom: '1px solid #1f1d2e',
              }}
            >
              <span>Type</span>
              <span>Gift</span>
              <span>Amount</span>
              <span>Price (GX)</span>
              <span>Total (GX)</span>
              <span>Date</span>
              <span>Status</span>
            </div>
            {mockOrders.map((order) => (
              <div
                className='gx-activity-row'
                key={order.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 2fr 1fr 1.5fr 1.5fr 1.5fr 1fr',
                  padding: '16px 20px',
                  alignItems: 'center',
                  fontSize: '13px',
                  borderBottom: '1px solid rgba(31, 29, 46, 0.5)',
                }}
              >
                <span>
                  <b className={order.side === 'buy' ? 'gx-positive' : 'gx-negative'}>
                    {order.side.toUpperCase()}
                  </b>
                </span>
                <span style={{ color: '#f6f3ff' }}>
                  <strong>{order.gift.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT / GX</strong>
                </span>
                <span style={{ color: '#f6f3ff' }}>{order.amount}</span>
                <span style={{ color: '#f6f3ff' }}>{formatGX(order.price)}</span>
                <span style={{ color: '#f6f3ff' }}>
                  <strong>{formatGX(order.total)}</strong>
                </span>
                <span className='gx-muted' style={{ color: '#625d70' }}>
                  {order.date}
                </span>
                <span>
                  <em
                    className={`gx-status-badge ${order.status === 'filled' ? 'gx-badge-filled' : 'gx-badge-cancelled'}`}
                    style={{
                      fontStyle: 'normal',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background:
                        order.status === 'filled'
                          ? 'rgba(16, 185, 129, 0.1)'
                          : 'rgba(244, 63, 94, 0.1)',
                      color: order.status === 'filled' ? '#10b981' : '#f43f5e',
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    {order.status}
                  </em>
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className='gx-footer'>
          <span>© 2026 GiftX</span>
          <span>
            <i className='material-icons'>shield</i> Secure trading environment
          </span>
          <span>Terms &amp; Privacy</span>
        </footer>
      </main>
    </div>
  );
};

export default TransactionsScreen;
