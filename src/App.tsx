import Navigation from './navigation/Navigation';
import { GiftsProvider } from './context/GiftsContext';
// styles
import './styles/site.css';

const App: React.FC = () => (
  <GiftsProvider>
    <Navigation />
  </GiftsProvider>
);
export default App;
