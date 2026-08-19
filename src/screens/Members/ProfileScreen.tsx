import { useNavigate } from 'react-router-dom';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { useLanguage } from '../../context/LanguageContext';

const ProfileScreen: React.FC = () => {
  const navigate = useNavigate();
  const { isTelegram, user } = useTelegramWebApp();
  const { currentLang, openLangModal, t } = useLanguage();

  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Alex Smith';
  const displayHandle = user?.username ? `@${user.username}` : 'alexsmith.tg';
  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : 'AS';

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
          <button className='gx-nav-item gx-nav-item-active' type='button'>
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
            <i className='material-icons'>help_outline</i> {t('nav.help', 'Help center')}{' '}
            <span>↗</span>
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
            <strong>{t('profile.title', 'Profile & Settings')}</strong>
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
              />
            ) : (
              <button type='button' className='gx-top-avatar'>
                {initials}
              </button>
            )}
          </div>
        </header>

        <section className='gx-page-heading'>
          <div>
            <p className='gx-eyebrow'>
              ACCOUNT <span className='gx-heading-line' />
            </p>
            <h1>{t('profile.title', 'Your Profile')}</h1>
            <p className='gx-subheading'>
              {t('profile.subheading', 'Manage your personal details and app settings.')}
            </p>
          </div>
        </section>

        <section style={{ padding: '0 28px 28px' }}>
          <div className='gx-panel'>
            <div className='gx-panel-header'>
              <div>
                <span className='gx-panel-kicker'>{t('profile.details', 'DETAILS')}</span>
                <h2>{t('profile.personal_info', 'Personal Information')}</h2>
              </div>
            </div>
            <div
              style={{
                padding: '20px',
                display: 'flex',
                gap: '20px',
                alignItems: 'center',
                borderBottom: '1px solid #1f1d2e',
              }}
            >
              {user?.photo_url ? (
                <img
                  src={user.photo_url}
                  alt=''
                  style={{ width: 80, height: 80, borderRadius: '50%' }}
                />
              ) : (
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: '#8b76ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 32,
                    fontWeight: 600,
                  }}
                >
                  {initials}
                </div>
              )}
              <div>
                <h3 style={{ fontSize: 20, color: '#f6f3ff', marginBottom: 4 }}>{displayName}</h3>
                <p style={{ color: '#625d70', fontSize: 14 }}>{displayHandle}</p>
                {user?.is_premium && (
                  <span
                    style={{
                      display: 'inline-block',
                      marginTop: 8,
                      padding: '4px 8px',
                      background: 'rgba(139, 118, 255, 0.1)',
                      color: '#8b76ff',
                      fontSize: 11,
                      borderRadius: 4,
                      fontWeight: 600,
                    }}
                  >
                    TELEGRAM PREMIUM
                  </span>
                )}
              </div>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#625d70', fontSize: 14 }}>
                  {t('profile.user_id', 'User ID')}
                </span>
                <span style={{ color: '#f6f3ff', fontSize: 14, fontFamily: 'monospace' }}>
                  {user?.id || '981234567'}
                </span>
              </div>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span style={{ color: '#625d70', fontSize: 14 }}>
                  {t('profile.language', 'Language')}
                </span>
                <button
                  type='button'
                  onClick={openLangModal}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: '#1c1a2b',
                    border: '1px solid #322e4d',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    color: '#f6f3ff',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  <span>{currentLang.flag}</span>
                  <span>
                    {currentLang.nativeName} ({currentLang.name})
                  </span>
                  <i className='material-icons' style={{ fontSize: '16px', color: '#8b76ff' }}>
                    edit
                  </i>
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#625d70', fontSize: 14 }}>
                  {t('profile.platform', 'Platform')}
                </span>
                <span style={{ color: '#f6f3ff', fontSize: 14 }}>
                  {isTelegram ? 'Telegram Mini App' : 'Web'}
                </span>
              </div>
            </div>
          </div>

          <div className='gx-panel' style={{ marginTop: 28 }}>
            <div className='gx-panel-header'>
              <div>
                <span className='gx-panel-kicker'>{t('profile.preferences', 'PREFERENCES')}</span>
                <h2>{t('profile.settings', 'Settings')}</h2>
              </div>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Language Selector Box in Settings */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px',
                  backgroundColor: '#161424',
                  borderRadius: '12px',
                  border: '1px solid #232038',
                }}
              >
                <div>
                  <h4
                    style={{
                      color: '#f6f3ff',
                      fontSize: 15,
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>🌐</span> {t('profile.language', 'Interface Language')}
                  </h4>
                  <p style={{ color: '#8b859e', fontSize: 12 }}>
                    {t(
                      'profile.language_sub',
                      'Choose your preferred language with instant search filter'
                    )}
                  </p>
                </div>
                <button
                  type='button'
                  onClick={openLangModal}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    background: '#8b76ff',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(139, 118, 255, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
                  onMouseOut={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                >
                  <i className='material-icons' style={{ fontSize: '18px' }}>
                    search
                  </i>
                  <span>{t('profile.change_lang', 'Change Language')}</span>
                </button>
              </div>

              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <h4 style={{ color: '#f6f3ff', fontSize: 14, marginBottom: 4 }}>
                    {t('profile.trading_notif', 'Trading Notifications')}
                  </h4>
                  <p style={{ color: '#625d70', fontSize: 12 }}>
                    {t('profile.trading_notif_sub', 'Receive alerts when orders are filled')}
                  </p>
                </div>
                <div
                  style={{
                    width: 44,
                    height: 24,
                    background: '#8b76ff',
                    borderRadius: 12,
                    position: 'relative',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      background: '#fff',
                      borderRadius: '50%',
                      position: 'absolute',
                      top: 2,
                      right: 2,
                    }}
                  />
                </div>
              </div>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <h4 style={{ color: '#f6f3ff', fontSize: 14, marginBottom: 4 }}>
                    {t('profile.hide_small', 'Hide Small Balances')}
                  </h4>
                  <p style={{ color: '#625d70', fontSize: 12 }}>
                    {t('profile.hide_small_sub', 'Hide assets worth less than 1 USDT')}
                  </p>
                </div>
                <div
                  style={{
                    width: 44,
                    height: 24,
                    background: '#1f1d2e',
                    borderRadius: 12,
                    position: 'relative',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      background: '#625d70',
                      borderRadius: '50%',
                      position: 'absolute',
                      top: 2,
                      left: 2,
                    }}
                  />
                </div>
              </div>
            </div>
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

export default ProfileScreen;
