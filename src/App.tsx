import Navigation from './navigation/Navigation';
import { GiftsProvider } from './context/GiftsContext';
import { LanguageProvider } from './context/LanguageContext';
import { LanguageModal } from './components/LanguageModal';
// styles
import './styles/site.css';

const App: React.FC = () => (
  <LanguageProvider>
    <GiftsProvider>
      <Navigation />
      <LanguageModal />
    </GiftsProvider>
  </LanguageProvider>
);
export default App;

