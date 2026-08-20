import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';
import { TonConnectButton, useTonWallet, useTonConnectUI } from '@tonconnect/ui-react';

const SignupScreen: React.FC = () => {
  const navigate = useNavigate();
  const { isTelegram, user } = useTelegramWebApp();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();

  const handleContinue = () => {
    // If not in Telegram, we'd normally block or mock.
    // For now, if wallet is connected or we are in Telegram, let them in.
    navigate('/market');
  };

  return (
    <div
      className='gx-app'
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0a0910',
        padding: '40px 20px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '80vw',
          height: '80vw',
          background: 'radial-gradient(circle, rgba(139,118,255,0.08) 0%, rgba(10,9,16,0) 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      <div
        className='gx-panel'
        style={{
          width: '100%',
          maxWidth: 400,
          padding: '40px 32px',
          position: 'relative',
          zIndex: 1,
          background: 'rgba(21, 20, 27, 0.7)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 24,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            style={{
              fontSize: '36px',
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              marginBottom: 16,
            }}
          >
            Gift<span style={{ color: '#8b76ff' }}>X</span>
          </div>
          <h1 style={{ fontSize: 24, color: '#f6f3ff', margin: '0 0 12px', fontWeight: 600 }}>
            Welcome
          </h1>
          <p style={{ color: '#8c879a', fontSize: 15, margin: 0, lineHeight: 1.5 }}>
            {isTelegram && user
              ? `Hello, ${user.first_name}! Connect your wallet to start trading.`
              : 'Connect your Telegram and Gram wallet to start trading rare gifts.'}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
            <TonConnectButton style={{ width: '100%' }} />
          </div>

          <button
            className='gx-submit'
            style={{
              marginTop: 12,
              opacity: wallet || (isTelegram && user) ? 1 : 0.5,
              background: wallet ? '#8b76ff' : '#2a2840',
              color: wallet ? '#ffffff' : '#8c879a',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={handleContinue}
          >
            {wallet ? 'Enter Exchange' : 'Continue as Guest'}
          </button>
        </div>
      </div>
    </div>
  );
};
export default SignupScreen;
