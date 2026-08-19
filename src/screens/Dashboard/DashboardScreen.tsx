import { DepositModal } from './DepositModal';
import { WithdrawModal } from './WithdrawModal';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { formatUSDT } from '../../data/gifts';
import { useLanguage } from '../../context/LanguageContext';
import { useTonConnectUI, useTonAddress, useTonWallet } from '@tonconnect/ui-react';
import { beginCell } from '@ton/core';

type Tab = 'deposit' | 'withdraw';


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

  const [gramRate, setGramRate] = useState<number>(5.50);
  
  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await fetch('/api/rates');
        const data = await res.json();
        if (data && data.gram) {
          setGramRate(data.gram);
        }
      } catch (e) {
        console.error('Failed to fetch rate:', e);
      }
    };
    fetchRate();
    const intervalId = setInterval(fetchRate, 30000);
    return () => clearInterval(intervalId);
  }, []);

  const [amount, setAmount] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);

  const [tonConnectUI] = useTonConnectUI();
  const address = useTonAddress();
  const wallet = useTonWallet();

  const rate = gramRate;
  const unit = '💎 Gram';
  const gxPreview = Number(amount) > 0 ? Number(amount) * rate : 0;

  useEffect(() => {
    if (address) {
      setWalletAddress(address);
    }
  }, [address]);

  const handleTonDeposit = async () => {
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }
    
    if (Number(amount) <= 0) return;

    try {
      const nanoTon = Math.floor(Number(amount) * 1e9).toString();
      const userId = user?.id || 'demo_user';
      
      // 1. Fetch Hot Wallet Address from server
      const configRes = await fetch('/api/config');
      const config = await configRes.json();
      const hotWallet = config.hotWalletAddress || address; // Fallback to own address if not configured
      
      // Standard way to add a text comment in Gram
      const body = beginCell()
        .storeUint(0, 32)
        .storeStringTail(`Deposit_${userId}`)
        .endCell();

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 360,
        messages: [
          {
            address: hotWallet, 
            amount: nanoTon,
            payload: body.toBoc().toString('base64')
          }
        ]
      };

      await tonConnectUI.sendTransaction(transaction);
      setIsModalOpen(true); // show success modal or proceed
    } catch (e) {
      console.error('Transaction error:', e);
    }
  };

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
        <div className='gx-workspace-label gx-workspace-label-space'>
          {t('nav.account', 'Account')}
        </div>
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
            <i className='material-icons'>help_outline</i> {t('nav.help', 'Help center')}{' '}
            <span>↗</span>
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
            <strong>
              {tab === 'deposit' ? t('nav.deposit', 'Deposit') : t('nav.withdraw', 'Withdraw')}
            </strong>
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
                ? 'Top up your USDT balance with Telegram Stars or USDT.'
                : 'Withdraw your USDT balance as crypto via Telegram bots.'}
            </p>
          </div>
          <div className='gx-balance'>
            <span>Available balance</span>
            <strong>
              12,480.50 <small>USDT</small>
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
                  Deposit Gram to receive USDT instantly
                </p>

                <label className='gx-input-label'>
                  Amount <span>{unit}</span>
                  <div className='gx-order-input'>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode='decimal'
                      placeholder='0'
                    />
                    <span>Gram</span>
                  </div>
                </label>

                <div className='gx-order-summary' style={{ marginTop: 12 }}>
                  <span>
                    Rate{' '}
                    <b>
                      1 Gram = {gramRate.toFixed(2)} USDT
                    </b>
                  </span>
                  <span>
                    You receive <strong>{formatUSDT(gxPreview)} USDT</strong>
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
                  onClick={handleTonDeposit}
                >
                  {wallet ? '💎 Deposit Gram' : '💎 Connect Wallet'}
                  <i className='material-icons'>{wallet ? 'arrow_forward' : 'account_balance_wallet'}</i>
                </button>
                <p className='gx-order-disclaimer'>
                  <i className='material-icons'>lock</i> Payments processed securely
                </p>
              </div>
            ) : (
              <div style={{ padding: '20px' }}>
                <p style={{ color: '#625d70', fontSize: 12, marginBottom: 16 }}>
                  Withdraw USDT as cryptocurrency via Telegram bots
                </p>

                <label className='gx-input-label'>
                  USDT amount <span>USDT</span>
                  <div className='gx-order-input'>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode='decimal'
                      placeholder='0'
                    />
                    <span>USDT</span>
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
                  Wallet address (Gram)
                  <div className='gx-order-input' style={{ display: 'flex', gap: 8 }}>
                    <input
                      placeholder='UQ...'
                      value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    {!wallet && (
                      <button 
                        type="button"
                        onClick={() => tonConnectUI.openModal()}
                        style={{
                          background: 'rgba(139, 118, 255, 0.15)',
                          color: '#8b76ff',
                          border: 'none',
                          padding: '0 16px',
                          borderRadius: 8,
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: 13,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </label>

                <div className='gx-order-summary' style={{ marginTop: 12 }}>
                  <span>
                    Available <b>12,480.50 USDT</b>
                  </span>
                  <span>
                    Min withdrawal <b>100 USDT</b>
                  </span>
                  <span>
                    Processing <b>Direct to wallet</b>
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
                  <i className='material-icons'>lock</i> Exchange signs tx and sends Gram
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
                      icon: 'account_balance_wallet',
                      title: 'Gram deposit',
                      text: 'Send Gram securely from your wallet to instantly top up your USDT balance.',
                    },
                    {
                      icon: 'bolt',
                      title: 'Instant credit',
                      text: 'Gram deposits are credited instantly based on the current market rate.',
                    },
                  ]
                : [
                    {
                      icon: 'output',
                      title: 'Crypto withdrawal',
                      text: 'Withdraw your USDT balance directly to your connected Gram wallet. Fast and secure.',
                    },
                    {
                      icon: 'schedule',
                      title: 'Processing time',
                      text: 'Our backend Hot Wallet automatically signs and executes your withdrawal in seconds.',
                    },
                    {
                      icon: 'security',
                      title: 'Security',
                      text: 'No smart-contract locks required for withdrawal. Handled by centralized matching.',
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
          rate={gramRate}
        />
      )}
    </div>
  );
};

export default DashboardScreen;
