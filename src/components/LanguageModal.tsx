import React, { useState, useMemo } from 'react';
import { useLanguage, LANGUAGES } from '../context/LanguageContext';

export const LanguageModal: React.FC = () => {
  const { currentLang, setLanguage, isLangModalOpen, closeLangModal, t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLanguages = useMemo(() => {
    if (!searchTerm.trim()) return LANGUAGES;
    const q = searchTerm.toLowerCase().trim();
    return LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  if (!isLangModalOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={closeLangModal}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '85vh',
          backgroundColor: '#12111a',
          border: '1px solid #28253b',
          borderRadius: '16px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #1f1d2e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🌐</span>
            <h3 style={{ margin: 0, color: '#f6f3ff', fontSize: '18px', fontWeight: 600 }}>
              {t('profile.select_lang_title', 'Выберите язык')}
            </h3>
          </div>
          <button
            type="button"
            onClick={closeLangModal}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b859e',
              cursor: 'pointer',
              fontSize: '20px',
              padding: '4px 8px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseOver={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseOut={(e) => (e.currentTarget.style.color = '#8b859e')}
          >
            ✕
          </button>
        </div>

        {/* Search Input Bar */}
        <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid #1a1827' }}>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#181625',
              border: '1px solid #2d2942',
              borderRadius: '10px',
              padding: '0 12px',
            }}
          >
            <i
              className="material-icons"
              style={{ color: '#8b76ff', fontSize: '20px', marginRight: '8px' }}
            >
              search
            </i>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('profile.search_placeholder', 'Поиск языка...')}
              autoFocus
              style={{
                width: '100%',
                padding: '12px 0',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#f6f3ff',
                fontSize: '14px',
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#625d70',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Language List */}
        <div
          style={{
            padding: '12px 16px',
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '8px',
            maxHeight: '50vh',
          }}
        >
          {filteredLanguages.length > 0 ? (
            filteredLanguages.map((lang) => {
              const isActive = lang.code === currentLang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => {
                    setLanguage(lang.code);
                    closeLangModal();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    backgroundColor: isActive ? 'rgba(139, 118, 255, 0.15)' : '#161424',
                    border: isActive ? '1px solid #8b76ff' : '1px solid #211e33',
                    color: isActive ? '#fff' : '#c8c4d6',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseOver={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = '#1f1c32';
                      e.currentTarget.style.borderColor = '#383354';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = '#161424';
                      e.currentTarget.style.borderColor = '#211e33';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>{lang.flag}</span>
                    <div>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: isActive ? 600 : 500,
                          color: isActive ? '#8b76ff' : '#f6f3ff',
                        }}
                      >
                        {lang.nativeName}
                      </div>
                      <div style={{ fontSize: '11px', color: '#625d70' }}>{lang.name}</div>
                    </div>
                  </div>
                  {isActive && (
                    <span
                      style={{
                        color: '#8b76ff',
                        fontSize: '16px',
                        fontWeight: 'bold',
                      }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '32px',
                textAlign: 'center',
                color: '#625d70',
                fontSize: '14px',
              }}
            >
              {t('profile.no_languages', 'Язык не найден')}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: '1px solid #1f1d2e',
            backgroundColor: '#100f18',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '12px', color: '#625d70' }}>
            {filteredLanguages.length} {t('profile.languages_count', 'языков')}
          </span>
          <button
            type="button"
            onClick={closeLangModal}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              background: '#232038',
              border: 'none',
              color: '#f6f3ff',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('common.cancel', 'Закрыть')}
          </button>
        </div>
      </div>
    </div>
  );
};
