import React, { useState, useEffect } from 'react';
import { formatUSDT } from '../../data/gifts';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: string;
  walletAddress: string;
  rate: number;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  amount,
  walletAddress,
  rate,
}) => {
  const [status, setStatus] = useState<'confirm' | 'processing' | 'success' | 'error'>('confirm');

  useEffect(() => {
    if (isOpen) {
      setStatus('confirm');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    setStatus('processing');

    // Simulate API call for withdrawal
    setTimeout(() => {
      setStatus('success');
    }, 2000);
  };

  const tonAmount = (Number(amount) / rate).toFixed(2);

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
                  color: '#f43f5e',
                  marginBottom: 12,
                }}
              >
                output
              </i>
              <h2 style={{ fontSize: 20, color: '#f6f3ff', margin: '0 0 8px 0' }}>
                Confirm Withdrawal
              </h2>
              <p style={{ color: '#625d70', fontSize: 14, margin: 0 }}>
                You are about to withdraw {formatUSDT(Number(amount))} USDT to the following wallet
                address.
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
                <span style={{ color: '#625d70', fontSize: 14 }}>USDT Amount</span>
                <span style={{ color: '#f6f3ff', fontSize: 14, fontWeight: 600 }}>
                  {formatUSDT(Number(amount))} USDT
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#625d70', fontSize: 14 }}>Address</span>
                <span
                  style={{
                    color: '#f6f3ff',
                    fontSize: 14,
                    fontFamily: 'monospace',
                    maxWidth: '150px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {walletAddress}
                </span>
              </div>
              <div style={{ height: 1, background: '#2a2840', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#625d70', fontSize: 14 }}>You Receive (est.)</span>
                <span style={{ color: '#f43f5e', fontSize: 16, fontWeight: 700 }}>
                  ~ {tonAmount} Gram
                </span>
              </div>
            </div>

            <button
              type='button'
              className='gx-submit gx-submit-sell'
              onClick={handleConfirm}
              style={{ width: '100%' }}
            >
              Confirm Withdrawal
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
                border: '3px solid rgba(244, 63, 94, 0.3)',
                borderTopColor: '#f43f5e',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <h2 style={{ fontSize: 18, color: '#f6f3ff', margin: '0 0 8px 0' }}>
              Processing Withdrawal
            </h2>
            <p style={{ color: '#625d70', fontSize: 14, margin: 0 }}>
              Initiating transfer to your wallet...
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
              Withdrawal Initiated!
            </h2>
            <p style={{ color: '#625d70', fontSize: 14, margin: '0 0 24px 0' }}>
              Your withdrawal of {formatUSDT(Number(amount))} USDT has been queued. The funds will
              arrive in your wallet shortly.
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
