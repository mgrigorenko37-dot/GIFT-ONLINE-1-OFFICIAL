import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const SignupScreen: React.FC = () => {
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
        background: '#0f0e15',
        padding: '40px 0',
      }}
    >
      <div className='gx-panel' style={{ width: 440, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div className='gx-brand' style={{ justifyContent: 'center', marginBottom: 16 }}>
            <span className='gx-brand-mark'>G</span>
            <span className='gx-brand-name'>
              Gift<span>X</span>
            </span>
          </div>
          <h1 style={{ fontSize: 24, color: '#f6f3ff', margin: '0 0 8px' }}>Create account</h1>
          <p style={{ color: '#625d70', fontSize: 14, margin: 0 }}>
            Join the premier marketplace for Telegram gifts
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <label className='gx-input-label' style={{ flex: 1 }}>
              First name
              <div className='gx-order-input' style={{ marginTop: 8 }}>
                <input type='text' placeholder='Alex' />
              </div>
            </label>
            <label className='gx-input-label' style={{ flex: 1 }}>
              Last name
              <div className='gx-order-input' style={{ marginTop: 8 }}>
                <input type='text' placeholder='Smith' />
              </div>
            </label>
          </div>

          <label className='gx-input-label'>
            Email address
            <div className='gx-order-input' style={{ marginTop: 8 }}>
              <input type='email' placeholder='alex@example.com' />
            </div>
          </label>

          <label className='gx-input-label'>
            Phone number
            <div className='gx-order-input' style={{ marginTop: 8 }}>
              <input type='tel' placeholder='+1 234 567 8900' />
            </div>
          </label>

          <label className='gx-input-label'>
            Password
            <div className='gx-order-input' style={{ marginTop: 8 }}>
              <input type='password' placeholder='Create a strong password' />
            </div>
          </label>

          <button type='submit' className='gx-submit' style={{ marginTop: 12 }}>
            Create account
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 32, fontSize: 14, color: '#625d70' }}>
          Already have an account?{' '}
          <Link to='/members/signin' style={{ color: '#b59eff', textDecoration: 'none' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};
export default SignupScreen;
