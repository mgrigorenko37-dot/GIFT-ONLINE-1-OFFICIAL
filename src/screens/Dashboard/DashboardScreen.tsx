import { DepositModal } from './DepositModal';
import { WithdrawModal } from './WithdrawModal';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { formatGX } from '../../data/gifts';
import { useLanguage } from '../../context/LanguageContext';


type Tab = 'deposit' | 'withdraw';
type DepositMethod = 'stars' | 'usdt';

const STARS_RATE = 0.021; // 1 Star ≈ 0.021 GX (demo)
const USDT_RATE = 10.5; // 1 USDT = 10.5 GX (demo)

const DashboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const { currentLang, openLangModal, t } = useLanguage();
  const { isTelegram, user } = useTelegramWebApp();

  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Alex Smith';
  const displayHandle = user?.username ? `@${user.username}` : 'alexsmith.tg';
  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : 'AS';

  const location = useLocation();
  const [tab, setTab] = useState<Tab>((location.state as any)?.tab || 'deposit');
  useEffect(() => {
    if ((location.state as any)?.tab) {
      setTab((location.state as any).tab);
    } else {
      setTab('deposit');
    }
  }, [location.state]);
  const [method, setMethod] = useState<DepositMethod>('stars');
  const [amount, setAmount] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);

  const rate = method === 'stars' ? STARS_RATE : USDT_RATE;
  const unit = method === 'stars' ? '⭐ Stars' : '💵 USDT';
  const gxPreview = Number(amount) > 0 ? Number(amount) * rate : 0;

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
          <button className='gx-nav-item' type='button' onClick={() => navigate('/portfolio')}>
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
          <button className='gx-nav-item gx-nav-item-active' type='button'>
            <i className='material-icons'>add_card</i>
            <span>{t('nav.deposit', 'Deposit')}</span>
          </button>
          <button className='gx-nav-item' type='button' onClick={() => setTab('withdraw')}>
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
            <strong>{tab === 'deposit' ? t('nav.deposit', 'Deposit') : t('nav.withdraw', 'Withdraw')}</strong>
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
              FUNDS <span className='gx-heading-line' />
            </p>
            <h1>{tab === 'deposit' ? 'Add funds' : 'Withdraw funds'}</h1>
            <p className='gx-subheading'>
              {tab === 'deposit'
                ? 'Top up your GX balance with Telegram Stars or USDT.'
                : 'Withdraw your GX balance as crypto via Telegram bots.'}
            </p>
          </div>
          <div className='gx-balance'>
            <span>Available balance</span>
            <strong>
              12,480.50 <small>GX</small>
            </strong>
          </div>
        </section>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '420px 1fr',
            gap: '20px',
            margin: '0 28px 28px',
            alignItems: 'start',
          }}
        >
          <section className='gx-panel'>
            <div className='gx-order-tabs' style={{ margin: '0' }}>
              <button
                type='button'
                className={tab === 'deposit' ? 'is-buy' : ''}
                onClick={() => setTab('deposit')}
              >
                Deposit
              </button>
              <button
                type='button'
                className={tab === 'withdraw' ? 'is-sell' : ''}
                onClick={() => setTab('withdraw')}
              >
                Withdraw
              </button>
            </div>

            {tab === 'deposit' ? (
              <div style={{ padding: '20px' }}>
                <p style={{ color: '#625d70', fontSize: 12, marginBottom: 16 }}>
                  Choose deposit method
                </p>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                  {(['stars', 'usdt'] as DepositMethod[]).map((m) => (
                    <button
                      key={m}
                      type='button'
                      onClick={() => {
                        setMethod(m);
                        setAmount('');
                      }}
                      style={{
                        flex: 1,
                        padding: '12px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        background: method === m ? 'rgba(181,158,255,0.12)' : '#161425',
                        border: method === m ? '1px solid #8b76ff' : '1px solid #2a2840',
                        color: method === m ? '#f6f3ff' : '#625d70',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {m === 'stars' ? '⭐ Telegram Stars' : '💵 USDT'}
                    </button>
                  ))}
                </div>

                <label className='gx-input-label'>
                  Amount <span>{unit}</span>
                  <div className='gx-order-input'>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode='decimal'
                      placeholder='0'
                    />
                    <span>{method === 'stars' ? '⭐' : 'USDT'}</span>
                  </div>
                </label>

                <div className='gx-order-summary' style={{ marginTop: 12 }}>
                  <span>
                    Rate{' '}
                    <b>
                      1 {method === 'stars' ? 'Star' : 'USDT'} ={' '}
                      {method === 'stars' ? STARS_RATE : USDT_RATE} GX
                    </b>
                  </span>
                  <span>
                    You receive <strong>{formatGX(gxPreview)} GX</strong>
                  </span>
                  <span>
                    Fee <b>0%</b>
                  </span>
                </div>

                <button
                  type='button'
                  className='gx-submit'
                  style={{ marginTop: 16 }}
                  disabled={!Number(amount)}
                  onClick={() => setIsModalOpen(true)}
                >
                  {method === 'stars' ? '⭐ Pay with Stars' : '💵 Pay with USDT'}
                  <i className='material-icons'>arrow_forward</i>
                </button>
                <p className='gx-order-disclaimer'>
                  <i className='material-icons'>lock</i> Payments processed via Telegram
                </p>
              </div>
            ) : (
              <div style={{ padding: '20px' }}>
                <p style={{ color: '#625d70', fontSize: 12, marginBottom: 16 }}>
                  Withdraw GX as cryptocurrency via Telegram bots
                </p>

                <label className='gx-input-label'>
                  GX amount <span>GX</span>
                  <div className='gx-order-input'>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode='decimal'
                      placeholder='0'
                    />
                    <span>GX</span>
                  </div>
                </label>

                <div className='gx-percent-row' style={{ marginTop: 8 }}>
                  {['25%', '50%', '75%', '100%'].map((p) => (
                    <button
                      key={p}
                      type='button'
                      onClick={() =>
                        setAmount(String((12480.5 * Number(p.replace('%', ''))) / 100))
                      }
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <label className='gx-input-label' style={{ marginTop: 16 }}>
                  Wallet address
                  <div className='gx-order-input'>
                    <input
                      placeholder='UQ...'
                      value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)}
                    />
                  </div>
                </label>

                <div className='gx-order-summary' style={{ marginTop: 12 }}>
                  <span>
                    Available <b>12,480.50 GX</b>
                  </span>
                  <span>
                    Min withdrawal <b>100 GX</b>
                  </span>
                  <span>
                    Processing <b>via @wallet bot</b>
                  </span>
                </div>

                <button
                  type='button'
                  className='gx-submit gx-submit-sell'
                  style={{ marginTop: 16 }}
                  disabled={!Number(amount) || !walletAddress}
                  onClick={() => setIsWithdrawModalOpen(true)}
                >
                  Withdraw <i className='material-icons'>output</i>
                </button>
                <p className='gx-order-disclaimer'>
                  <i className='material-icons'>lock</i> Withdrawals processed via Telegram
                </p>
              </div>
            )}
          </section>

          <section className='gx-panel'>
            <div className='gx-panel-header'>
              <div>
                <span className='gx-panel-kicker'>INFO</span>
                <h2>How it works</h2>
              </div>
            </div>
            <div
              style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {(tab === 'deposit'
                ? [
                    {
                      icon: 'star',
                      title: 'Telegram Stars',
                      text: 'Buy Stars inside Telegram and instantly top up your GX balance. No external wallets needed.',
                    },
                    {
                      icon: 'attach_money',
                      title: 'USDT deposit',
                      text: 'Send USDT (TON network) to your personal deposit address. Balance is credited after 1 confirmation.',
                    },
                    {
                      icon: 'bolt',
                      title: 'Instant credit',
                      text: 'Star deposits are credited instantly. USDT deposits take ~30 seconds.',
                    },
                  ]
                : [
                    {
                      icon: 'output',
                      title: 'Crypto withdrawal',
                      text: 'Withdraw your GX balance as USDT or TON to any wallet via the @wallet Telegram bot.',
                    },
                    {
                      icon: 'schedule',
                      title: 'Processing time',
                      text: 'Withdrawals are processed within 5 minutes during trading hours.',
                    },
                    {
                      icon: 'security',
                      title: 'Security',
                      text: 'All withdrawals require Telegram identity confirmation. No 3rd-party logins.',
                    },
                  ]
              ).map(({ icon, title, text }) => (
                <div
                  key={title}
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px',
                    background: '#161425',
                    borderRadius: 10,
                  }}
                >
                  <i
                    className='material-icons'
                    style={{ color: '#8b76ff', fontSize: 22, marginTop: 2 }}
                  >
                    {icon}
                  </i>
                  <div>
                    <strong style={{ color: '#f6f3ff', fontSize: 13 }}>{title}</strong>
                    <p style={{ color: '#625d70', fontSize: 12, marginTop: 4 }}>{text}</p>
                  </div>
                </div>
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
      {isModalOpen && (
        <DepositModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          method={method}
          amount={amount}
          gxPreview={gxPreview}
        />
      )}
      {isWithdrawModalOpen && (
        <WithdrawModal
          isOpen={isWithdrawModalOpen}
          onClose={() => setIsWithdrawModalOpen(false)}
          amount={amount}
          walletAddress={walletAddress}
        />
      )}
    </div>
  );
};

export default DashboardScreen;
