import { Link } from 'react-router-dom';

const NotFoundScreen: React.FC = () => (
  <div
    className='gx-app'
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0f0e15',
      flexDirection: 'column',
    }}
  >
    <div className='gx-brand' style={{ marginBottom: 32 }}>
      <span className='gx-brand-mark'>G</span>
      <span className='gx-brand-name'>
        Gift<span>X</span>
      </span>
    </div>

    <h1 style={{ fontSize: 64, color: '#f6f3ff', margin: 0, fontWeight: 800 }}>404</h1>
    <p style={{ color: '#625d70', fontSize: 16, marginTop: 8, marginBottom: 32 }}>
      Market not found or unavailable.
    </p>

    <Link
      to='/'
      className='gx-submit'
      style={{ textDecoration: 'none', width: 'auto', padding: '0 24px', display: 'inline-flex' }}
    >
      Return to Terminal
    </Link>
  </div>
);

export default NotFoundScreen;
