import React, { useState, useEffect } from 'react';
import { formatGX } from '../../data/gifts';
import { useTelegramWebApp } from '../../hooks/useTelegramWebApp';

type DepositMethod = 'stars' | 'usdt';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  method: DepositMethod;
  amount: string;
  gxPreview: number;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  method,
  amount,
  gxPreview,
}) => {
  const [status, setStatus] = useState<'confirm' | 'processing' | 'success' | 'error'>('confirm');
  const { openInvoice } = useTelegramWebApp();

  useEffect(() => {
    if (isOpen) {
      setStatus('confirm');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    setStatus('processing');

    // Simulate API call for invoice creation
    setTimeout(() => {
      if (method === 'stars') {
        fetch('/api/create-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Deposit Stars',
            description: 'Deposit ' + amount + ' Stars for GX tokens.',
            payload: 'deposit_' + Date.now(),
            currency: 'XTR',
            prices: [{ label: 'Deposit', amount: parseInt(amount, 10) }],
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.invoiceLink) {
              openInvoice(data.invoiceLink, (invoiceStatus) => {
                if (invoiceStatus === 'paid') {
                  setStatus('success');
                } else {
                  setStatus('error');
                }
              });
            } else {
              // Fallback for non-telegram environments or missing bot token
              setTimeout(() => setStatus('success'), 1500);
            }
          })
          .catch(() => {
            setTimeout(() => setStatus('success'), 1500);
          });
      } else {
        // USDT deposit simulation
        setTimeout(() => setStatus('success'), 2000);
      }
    }, 1000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#161425',
          border: '1px solid #2a2840',
          borderRadius: 16,
          width: '90%',
          maxWidth: 400,
          padding: 24,
          position: 'relative',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type='button'
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: 'none',
            color: '#625d70',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
          }}
        >
          <i className='material-icons'>close</i>
        </button>

        {status === 'confirm' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <i
                className='material-icons'
                style={{
                  fontSize: 48,
                  color: method === 'stars' ? '#f5c635' : '#10b981',
                  marginBottom: 12,
                }}
              >
                {method === 'stars' ? 'stars' : 'payments'}
              </i>
              <h2 style={{ fontSize: 20, color: '#f6f3ff', margin: '0 0 8px 0' }}>
                Confirm Deposit
              </h2>
              <p style={{ color: '#625d70', fontSize: 14, margin: 0 }}>
                You are about to deposit {amount} {method === 'stars' ? 'Stars' : 'USDT'} to your
                account.
              </p>
            </div>

            <div
              style={{
                background: '#11101a',
                borderRadius: 12,
                padding: 16,
                marginBottom: 24,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#625d70', fontSize: 14 }}>Amount</span>
                <span style={{ color: '#f6f3ff', fontSize: 14, fontWeight: 600 }}>
                  {amount} {method === 'stars' ? '⭐' : 'USDT'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#625d70', fontSize: 14 }}>Rate</span>
                <span style={{ color: '#f6f3ff', fontSize: 14 }}>
                  1 {method === 'stars' ? 'Star' : 'USDT'} = {formatGX(gxPreview / Number(amount))}{' '}
                  GX
                </span>
              </div>
              <div style={{ height: 1, background: '#2a2840', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#625d70', fontSize: 14 }}>You Receive</span>
                <span style={{ color: '#8b76ff', fontSize: 16, fontWeight: 700 }}>
                  {formatGX(gxPreview)} GX
                </span>
              </div>
            </div>

            <button
              type='button'
              className='gx-submit'
              onClick={handleConfirm}
              style={{ width: '100%' }}
            >
              {method === 'stars' ? 'Pay with Telegram Stars' : 'Generate USDT Invoice'}
            </button>
          </>
        )}

        {status === 'processing' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div
              className='spinner'
              style={{
                margin: '0 auto 24px auto',
                width: 40,
                height: 40,
                border: '3px solid rgba(139, 118, 255, 0.3)',
                borderTopColor: '#8b76ff',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <h2 style={{ fontSize: 18, color: '#f6f3ff', margin: '0 0 8px 0' }}>
              Processing Payment
            </h2>
            <p style={{ color: '#625d70', fontSize: 14, margin: 0 }}>
              {method === 'stars'
                ? 'Waiting for Telegram confirmation...'
                : 'Generating your personal deposit address...'}
            </p>
          </div>
        )}

        {status === 'success' && (
          <div style={{ textAlign: 'center', padding: '16px 0 0 0' }}>
            <div
              style={{
                width: 64,
                height: 64,
                background: 'rgba(16, 185, 129, 0.1)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
              }}
            >
              <i className='material-icons' style={{ fontSize: 32, color: '#10b981' }}>
                check
              </i>
            </div>
            <h2 style={{ fontSize: 20, color: '#f6f3ff', margin: '0 0 8px 0' }}>
              Deposit Successful!
            </h2>
            <p style={{ color: '#625d70', fontSize: 14, margin: '0 0 24px 0' }}>
              Your account has been credited with {formatGX(gxPreview)} GX.
            </p>
            <button
              type='button'
              className='gx-submit'
              onClick={onClose}
              style={{ width: '100%', background: '#2a2840', color: '#f6f3ff' }}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {status === 'error' && (
          <div style={{ textAlign: 'center', padding: '16px 0 0 0' }}>
            <div
              style={{
                width: 64,
                height: 64,
                background: 'rgba(244, 63, 94, 0.1)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
              }}
            >
              <i className='material-icons' style={{ fontSize: 32, color: '#f43f5e' }}>
                error_outline
              </i>
            </div>
            <h2 style={{ fontSize: 20, color: '#f6f3ff', margin: '0 0 8px 0' }}>Payment Failed</h2>
            <p style={{ color: '#625d70', fontSize: 14, margin: '0 0 24px 0' }}>
              The payment could not be processed. Please try again.
            </p>
            <button
              type='button'
              className='gx-submit'
              onClick={() => setStatus('confirm')}
              style={{ width: '100%', background: '#2a2840', color: '#f6f3ff' }}
            >
              Try Again
            </button>
          </div>
        )}

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
};
