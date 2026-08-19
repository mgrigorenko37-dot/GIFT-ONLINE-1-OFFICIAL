import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatUSDT, type Gift } from '../../data/gifts';
import { useGifts } from '../../context/GiftsContext';
import { useLanguage } from '../../context/LanguageContext';

type SortKey = 'floor' | 'change' | 'volume';

const rarityOptions = ['All', 'Common', 'Rare', 'Epic', 'Limited', 'Legendary'];

const GiftArtwork: React.FC<{ className: string; large?: boolean; emoji?: string; image_url?: string }> = ({
  className,
  large,
  emoji,
  image_url,
}) => {
  if (image_url) {
    return (
      <div
        className={`gift-art ${className} ${large ? 'gift-art-large' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: large ? '48px' : '24px',
          background: 'transparent'
        }}
      >
        <img
          src={image_url}
          alt='gift'
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      </div>
    );
  }
  if (emoji) {
    return (
      <div
        className={`gift-art ${className} ${large ? 'gift-art-large' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: large ? '48px' : '24px',
        }}
      >
        <img
          src={`https://emojik.vercel.app/s/${emoji}`}
          alt='emoji'
          style={{ width: large ? '48px' : '24px', height: large ? '48px' : '24px' }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.parentElement!.innerHTML = emoji;
          }}
        />
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

const volumeValue = (volume: string) => Number(volume.replace('K', '')) * 1000;

const CapitalScreen: React.FC = () => {
  const { gifts, loading } = useGifts();
  const navigate = useNavigate();
  const { currentLang, openLangModal, t } = useLanguage();
  const [search, setSearch] = useState('');
  const [rarity, setRarity] = useState('All');
  const [sort, setSort] = useState<SortKey>('volume');

  const visibleGifts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return gifts
      .filter(
        (gift) =>
          (rarity === 'All' || gift.rarity === rarity) &&
          (!query || `${gift.name} ${gift.rarity}`.toLowerCase().includes(query))
      )
      .sort((first, second) => {
        if (sort === 'change') return second.change - first.change;
        if (sort === 'floor') return first.floor - second.floor;
        return volumeValue(second.volume) - volumeValue(first.volume);
      });
  }, [rarity, search, sort]);

  const selectGift = (gift: Gift) => navigate(`/market?gift=${gift.id}`);

  return (
    <div className='gx-app gx-markets-page'>
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
          <button className='gx-nav-item gx-nav-item-active' type='button'>
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
        </div>
      </aside>

      <main className='gx-main'>
        <header className='gx-topbar'>
          <div className='gx-breadcrumb'>
            <span>{t('nav.workspace', 'Workspace')}</span>
            <i className='material-icons'>chevron_right</i>
            <strong>{t('terminal.markets', 'Markets')}</strong>
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
              <span /> Demo market data
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
            <button
              type='button'
              className='gx-top-avatar'
              onClick={() => navigate('/profile')}
              style={{ cursor: 'pointer' }}
            >
              AS
            </button>
          </div>
        </header>

        <section className='gx-markets-heading'>
          <div>
            <p className='gx-eyebrow'>
              USDT MARKET <span className='gx-heading-line' />
            </p>
            <h1>Gift markets</h1>
            <p className='gx-subheading'>
              Compare collectible Telegram gifts and find the next market to trade.
            </p>
          </div>
          <div className='gx-market-summary'>
            <span>Tracked markets</span>
            <strong>{gifts.length}</strong>
            <small>Demo listings</small>
          </div>
        </section>

        <section className='gx-market-stats'>
          <div>
            <span>Total market volume</span>
            <strong>
              1.84M <small>USDT</small>
            </strong>
            <em className='gx-positive'>+6.28% today</em>
          </div>
          <div>
            <span>Best performer</span>
            <strong>Signet Ring</strong>
            <em className='gx-positive'>+12.60%</em>
          </div>
          <div>
            <span>Highest floor</span>
            <strong>
              640.00 <small>USDT</small>
            </strong>
            <em>Genie Lamp</em>
          </div>
          <div>
            <span>Market status</span>
            <strong>
              <i className='gx-status-dot' /> Active
            </strong>
            <em>Prices are demo data</em>
          </div>
        </section>

        <section className='gx-panel gx-market-browser'>
          <div className='gx-panel-header gx-market-browser-header'>
            <div>
              <span className='gx-panel-kicker'>EXPLORE COLLECTIONS</span>
              <h2>
                All gift markets <small>{visibleGifts.length} results</small>
              </h2>
            </div>
            <label className='gx-market-search'>
              <i className='material-icons'>search</i>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder='Search gifts'
                aria-label='Search gifts'
              />
            </label>
          </div>
          <div className='gx-market-controls'>
            <div className='gx-filter-group' aria-label='Filter by rarity'>
              {rarityOptions.map((option) => (
                <button
                  type='button'
                  key={option}
                  className={rarity === option ? 'is-active' : ''}
                  onClick={() => setRarity(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <label className='gx-sort-select'>
              Sort by{' '}
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                <option value='volume'>Volume</option>
                <option value='floor'>Lowest floor</option>
                <option value='change'>24h change</option>
              </select>
              <i className='material-icons'>expand_more</i>
            </label>
          </div>
          {visibleGifts.length > 0 ? (
            <div className='gx-market-cards'>
              {visibleGifts.map((gift) => (
                <article className='gx-market-card' key={gift.id}>
                  <div className='gx-card-art-wrap'>
                    <GiftArtwork className={gift.className} large emoji={gift.emoji} image_url={gift.image_url} />
                    <span
                      className={
                        gift.change > 0
                          ? 'gx-card-change gx-positive'
                          : 'gx-card-change gx-negative'
                      }
                    >
                      {gift.change > 0 ? '+' : ''}
                      {gift.change}%
                    </span>
                  </div>
                  <div className='gx-card-title'>
                    <div>
                      <h3>{gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GIFT</h3>
                      <span>{gift.collection}</span>
                    </div>
                    <i className='material-icons'>more_horiz</i>
                  </div>
                  <div className='gx-card-meta'>
                    <div>
                      <span>Floor price</span>
                      <strong>
                        {formatUSDT(gift.floor)} <small>USDT</small>
                      </strong>
                    </div>
                    <div>
                      <span>24h volume</span>
                      <strong>
                        {gift.volume} <small>USDT</small>
                      </strong>
                    </div>
                  </div>
                  <div className='gx-card-footer'>
                    <span className={`gx-rarity gx-rarity-${gift.rarity.toLowerCase()}`}>
                      {gift.rarity}
                    </span>
                    <button type='button' onClick={() => selectGift(gift)}>
                      Trade now <i className='material-icons'>arrow_forward</i>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className='gx-market-empty'>
              <i className='material-icons'>search_off</i>
              <strong>No gifts found</strong>
              <span>Try another name or rarity.</span>
              <button
                type='button'
                onClick={() => {
                  setSearch('');
                  setRarity('All');
                }}
              >
                Reset filters
              </button>
            </div>
          )}
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

export default CapitalScreen;
