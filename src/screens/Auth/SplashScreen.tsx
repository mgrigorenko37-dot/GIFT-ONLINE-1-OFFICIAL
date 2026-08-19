import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SplashScreen: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Wait for 3 seconds, then navigate to registration (or terminal if already registered)
    const timer = setTimeout(() => {
      // We'll add logic later to check if user is already registered.
      // For now, always redirect to signup/auth page after splash.
      navigate('/members/signup');
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div
      className='gx-app'
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0a0910', // Darker background for splash
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background glow effects */}
      <div 
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '60vw',
          height: '60vw',
          background: 'radial-gradient(circle, rgba(139,118,255,0.15) 0%, rgba(10,9,16,0) 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      <div 
        style={{ 
          textAlign: 'center',
          animation: 'splash-fade-in-up 1s ease-out forwards',
        }}
      >
        <div 
          style={{
            fontSize: '48px',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
          }}
        >
          Gift<span style={{ color: '#8b76ff' }}>X</span>
        </div>
      </div>

      <style>
        {`
          @keyframes splash-fade-in-up {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes splash-fade-in {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        `}
      </style>
    </div>
  );
};

export default SplashScreen;