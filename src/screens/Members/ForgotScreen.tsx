import { useNavigate, Link } from 'react-router-dom';

const ForgotScreen: React.FC = () => {
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate('/members/signin');
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
          <h1 style={{ fontSize: 24, color: '#f6f3ff', margin: '0 0 8px' }}>Reset password</h1>
          <p style={{ color: '#625d70', fontSize: 14, margin: 0 }}>
            We'll send recovery instructions to your phone
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <label className='gx-input-label'>
            Phone number
            <div className='gx-order-input' style={{ marginTop: 8 }}>
              <input type='tel' placeholder='+1 234 567 8900' />
            </div>
          </label>

          <button type='submit' className='gx-submit' style={{ marginTop: 8 }}>
            Send instructions
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 32, fontSize: 14, color: '#625d70' }}>
          Remember your password?{' '}
          <Link to='/members/signin' style={{ color: '#b59eff', textDecoration: 'none' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};
export default ForgotScreen;
