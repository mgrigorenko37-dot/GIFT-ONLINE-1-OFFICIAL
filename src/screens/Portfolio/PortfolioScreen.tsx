import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { formatGX, type Gift } from '../../data/gifts';
import { useGifts } from '../../context/GiftsContext';
import { useLanguage } from '../../context/LanguageContext';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

const GiftArtwork: React.FC<{ className: string; large?: boolean; emoji?: string }> = ({ className, large, emoji }) => {
  if (emoji) {
    return (
      <div className={`gift-art ${className} ${large ? 'gift-art-large' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: large ? '48px' : '24px' }}>
        <img src={`https://emojik.vercel.app/s/${emoji}`} alt="emoji" style={{ width: large ? '48px' : '24px', height: large ? '48px' : '24px' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.innerHTML = emoji; }} />
      </div>
    );
  }
  return (
    <div className={`gift-art ${className} ${large ? 'gift-art-large' : ''}`} aria-hidden='true'>
      <span className='gift-art-glow' />
      <span className='gift-art-shape' />
      <span className='gift-art-shine' />
    </div>
  );
};

const PortfolioScreen: React.FC = () => {
  const { gifts, loading } = useGifts();
  const { currentLang, openLangModal, t } = useLanguage();
  const myGifts = [
    { ...gifts[0], shares: 300, avgBuy: 118.4, pnl: +19.2 },
    { ...gifts[3], shares: 750, avgBuy: 51.2, pnl: +15.0 },
    { ...gifts[1], shares: 120, avgBuy: 90.0, pnl: -4.2 },
    { ...gifts[5], shares: 50, avgBuy: 610.0, pnl: +4.9 },
  ].filter(g => g.id);
  const navigate = useNavigate();

  const { isTelegram, user } = useTelegramWebApp();

  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Alex Smith';
  const displayHandle = user?.username ? `@${user.username}` : 'alexsmith.tg';
  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : 'AS';

  const portfolioValue = myGifts.reduce((s, g) => s + g.floor * g.shares, 0);

  const chartOptions: ApexOptions = useMemo(
    () => ({
      chart: { type: 'donut', background: 'transparent' },
      theme: { mode: 'dark' },
      labels: myGifts.map((g) => g.name),
      colors: ['#b59eff', '#8b76ff', '#f43f5e', '#10b981', '#f59e0b', '#0ea5e9'],
      stroke: { width: 0 },
      dataLabels: { enabled: false },
      plotOptions: {
        pie: {
          donut: {
            size: '75%',
            labels: {
              show: true,
              name: { color: '#625d70', fontSize: '12px' },
              value: {
                color: '#f6f3ff',
                fontSize: '20px',
                fontWeight: 600,
                formatter: (val) => `${val} GX`,
              },
              total: {
                show: true,
                label: 'Total Value',
                color: '#625d70',
                formatter: () => `${formatGX(portfolioValue)} GX`,
              },
            },
          },
        },
      },
      legend: { show: false },
      tooltip: { y: { formatter: (val) => `${val} GX` } },
    }),
    [portfolioValue]
  );

  const chartSeries = useMemo(() => myGifts.map((g) => g.floor * g.shares), []);

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
          <button className='gx-nav-item' type='button' onClick={() => navigate('/market')}>
            <i className='material-icons'>candlestick_chart</i>
            <span>{t('nav.trade', 'Trade')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/capital')}>
            <i className='material-icons'>storefront</i>
            <span>{t('nav.gifts', 'Gifts')}</span>
          </button>
          <button className='gx-nav-item gx-nav-item-active' type='button'>
            <i className='material-icons'>card_giftcard</i>
            <span>{t('nav.portfolio', 'Portfolio')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => navigate('/transactions')}>
            <i className='material-icons'>history</i>
            <span>{t('nav.activity', 'Activity')}</span>
          </button>
        </nav>

        <div className='gx-workspace-label gx-workspace-label-space'>{t('nav.account', 'Account')}</div>
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
          <button className='gx-nav-item' type='button' onClick={openLangModal}>
            <i className='material-icons'>settings</i>
            <span>{t('nav.settings', 'Settings')}</span>
          </button>
        </nav>

        <div className='gx-sidebar-bottom'>
          <div className='gx-status'>
            <span className='gx-status-dot' /> {t('nav.operational', 'All systems operational')}
          </div>
          <button className='gx-help-button' type='button'>
            <i className='material-icons'>help_outline</i> {t('nav.help', 'Help center')} <span>↗</span>
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
            <span>{t('nav.account', 'Account')}</span>
            <i className='material-icons'>chevron_right</i>
            <strong>{t('nav.portfolio', 'Portfolio')}</strong>
          </div>
          <div className='gx-top-actions'>
            <button
              type='button'
              onClick={openLangModal}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(139, 118, 255, 0.12)',
                border: '1px solid rgba(139, 118, 255, 0.3)',
                borderRadius: '20px',
                padding: '4px 12px',
                color: '#f6f3ff',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              <span>{currentLang.flag}</span>
              <span>{currentLang.nativeName}</span>
              <i className='material-icons' style={{ fontSize: '16px', color: '#8b76ff' }}>
                arrow_drop_down
              </i>
            </button>
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
              PORTFOLIO <span className='gx-heading-line' />
            </p>
            <h1>My gift collection</h1>
            <p className='gx-subheading'>Track your holdings, performance, and current value.</p>
          </div>
          <div className='gx-balance'>
            <span>Available balance</span>
            <strong>
              12,480.50 <small>GX</small>
            </strong>
            <button type='button' onClick={() => navigate('/capital')}>
              <i className='material-icons'>add</i> Buy gifts
            </button>
          </div>
        </section>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '320px 1fr',
            gap: '24px',
            margin: '0 28px 28px',
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <section className='gx-panel'>
              <div className='gx-panel-header' style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <div>
                  <span className='gx-panel-kicker'>ALLOCATION</span>
                  <h2>Holdings breakdown</h2>
                </div>
              </div>
              <div
                style={{
                  padding: '0 20px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{ height: 260, width: '100%', display: 'flex', justifyContent: 'center' }}
                >
                  <Chart options={chartOptions} series={chartSeries} type='donut' height='260' />
                </div>
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginTop: 10,
                  }}
                >
                  {myGifts.map((g, i) => {
                    const colors = ['#b59eff', '#8b76ff', '#f43f5e', '#10b981'];
                    const pct = ((g.floor * g.shares) / portfolioValue) * 100;
                    return (
                      <div
                        key={g.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 13,
                          background: '#161425',
                          padding: '8px 12px',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: colors[i % colors.length],
                            }}
                          />
                          <span style={{ color: '#f6f3ff', fontWeight: 500 }}>{g.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ color: '#625d70' }}>{g.shares} Shares</span>
                          <span
                            style={{
                              color: '#f6f3ff',
                              fontWeight: 600,
                              width: 40,
                              textAlign: 'right',
                            }}
                          >
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className='gx-panel'>
              <div className='gx-panel-header' style={{ borderBottom: 'none' }}>
                <div>
                  <span className='gx-panel-kicker'>SUMMARY</span>
                  <h2>Performance</h2>
                </div>
              </div>
              <div
                style={{
                  padding: '0 20px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #1f1d2e',
                    paddingBottom: 10,
                  }}
                >
                  <span style={{ color: '#625d70', fontSize: 13 }}>Total Investment</span>
                  <span style={{ color: '#f6f3ff', fontSize: 13, fontWeight: 600 }}>
                    {formatGX(myGifts.reduce((s, g) => s + g.avgBuy * g.shares, 0))} GX
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #1f1d2e',
                    paddingBottom: 10,
                  }}
                >
                  <span style={{ color: '#625d70', fontSize: 13 }}>Current Value</span>
                  <span style={{ color: '#f6f3ff', fontSize: 13, fontWeight: 600 }}>
                    {formatGX(portfolioValue)} GX
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 4 }}>
                  <span style={{ color: '#625d70', fontSize: 13 }}>Total Profit/Loss</span>
                  <span className='gx-positive' style={{ fontSize: 13, fontWeight: 600 }}>
                    +8.42%
                  </span>
                </div>
              </div>
            </section>
          </div>

          <section
            className='gx-panel'
            style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <div>
                <span className='gx-panel-kicker'>ASSETS</span>
                <h2 style={{ fontSize: 20, margin: 0, color: '#f6f3ff' }}>My Gifts</h2>
              </div>
              <button type='button' className='gx-more-button' onClick={() => navigate('/capital')}>
                Browse all <i className='material-icons'>arrow_forward</i>
              </button>
            </div>

            <div className='gx-market-cards'>
              {myGifts.map((gift) => (
                <article
                  className='gx-market-card'
                  key={gift.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/market?gift=${gift.id}`)}
                >
                  <div className='gx-card-art-wrap'>
                    <GiftArtwork className={gift.className} large emoji={gift.emoji} />
                    <span
                      className={
                        gift.pnl > 0 ? 'gx-card-change gx-positive' : 'gx-card-change gx-negative'
                      }
                    >
                      {gift.pnl > 0 ? '+' : ''}
                      {gift.pnl}%
                    </span>
                  </div>

                  <div className='gx-card-title' style={{ marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 16 }}>
                        {gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT
                      </h3>
                      <span>{gift.shares} Shares</span>
                    </div>
                  </div>

                  <div
                    className='gx-card-meta'
                    style={{
                      display: 'flex',
                      gap: 12,
                      marginBottom: 16,
                      borderTop: 'none',
                      paddingTop: 0,
                    }}
                  >
                    <div
                      style={{
                        background: '#161425',
                        padding: '8px 12px',
                        borderRadius: 8,
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          color: '#625d70',
                          marginBottom: 2,
                        }}
                      >
                        Avg buy
                      </span>
                      <strong style={{ fontSize: 13, color: '#f6f3ff' }}>
                        {formatGX(gift.avgBuy)}{' '}
                        <small style={{ color: '#625d70', fontWeight: 'normal' }}>GX</small>
                      </strong>
                    </div>
                    <div
                      style={{
                        background: '#161425',
                        padding: '8px 12px',
                        borderRadius: 8,
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          color: '#625d70',
                          marginBottom: 2,
                        }}
                      >
                        Current
                      </span>
                      <strong style={{ fontSize: 13, color: '#f6f3ff' }}>
                        {formatGX(gift.floor)}{' '}
                        <small style={{ color: '#625d70', fontWeight: 'normal' }}>GX</small>
                      </strong>
                    </div>
                  </div>

                  <div
                    className='gx-card-footer'
                    style={{ borderTop: '1px solid #1f1d2e', paddingTop: 16, marginTop: 'auto' }}
                  >
                    <span className={`gx-rarity gx-rarity-${gift.rarity.toLowerCase()}`}>
                      {gift.rarity}
                    </span>
                    <strong style={{ fontSize: 14, color: '#f6f3ff' }}>
                      {formatGX(gift.floor * gift.shares)}{' '}
                      <small style={{ color: '#625d70' }}>GX</small>
                    </strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
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

export default PortfolioScreen;
