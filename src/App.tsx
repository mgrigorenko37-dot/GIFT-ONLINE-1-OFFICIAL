import Navigation from './navigation/Navigation';
import { GiftsProvider } from './context/GiftsContext';
import { LanguageProvider } from './context/LanguageContext';
import { LanguageModal } from './components/LanguageModal';
import { useEffect } from 'react';
import { useTonAddress } from '@tonconnect/ui-react';
import { useTelegramWebApp } from './hooks/useTelegramWebApp';

// styles
import './styles/site.css';

const App: React.FC = () => {
  const address = useTonAddress();
  const { user, initData } = useTelegramWebApp();

  useEffect(() => {
    if (address && user?.id) {
      fetch('/api/user/wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({ userId: String(user.id), walletAddress: address, initData }),
      }).catch((e) => console.error('Failed to link wallet:', e));
    }
  }, [address, user?.id, initData]);

  return (
    <LanguageProvider>
      <GiftsProvider>
        <Navigation />
        <LanguageModal />
      </GiftsProvider>
    </LanguageProvider>
  );
};

export default App;
