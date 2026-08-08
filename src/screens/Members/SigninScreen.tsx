import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const SigninScreen: React.FC = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

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
      }}
    >
      <div className='gx-panel' style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div className='gx-brand' style={{ justifyContent: 'center', marginBottom: 16 }}>
            <span className='gx-brand-mark'>G</span>
            <span className='gx-brand-name'>
              Gift<span>X</span>
            </span>
          </div>
          <h1 style={{ fontSize: 24, color: '#f6f3ff', margin: '0 0 8px' }}>Welcome back</h1>
          <p style={{ color: '#625d70', fontSize: 14, margin: 0 }}>Sign in to continue to GiftX</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <label className='gx-input-label'>
            Phone number
            <div className='gx-order-input' style={{ marginTop: 8 }}>
              <input
                type='text'
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder='+1 234 567 8900'
              />
            </div>
          </label>
          <label className='gx-input-label'>
            Password
            <div className='gx-order-input' style={{ marginTop: 8 }}>
              <input
                type='password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='Enter password'
              />
            </div>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Link
              to='/members/forgot-password'
              style={{ color: '#b59eff', fontSize: 13, textDecoration: 'none' }}
            >
              Forgot password?
            </Link>
          </div>

          <button type='submit' className='gx-submit' style={{ marginTop: 8 }}>
            Sign in
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 32, fontSize: 14, color: '#625d70' }}>
          Don't have an account?{' '}
          <Link to='/members/signup' style={{ color: '#b59eff', textDecoration: 'none' }}>
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
};
export default SigninScreen;
