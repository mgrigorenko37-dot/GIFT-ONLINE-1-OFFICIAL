import { Routes, Route, Navigate } from 'react-router-dom';

// pages
import SplashScreen from '../screens/Auth/SplashScreen';
import SignupScreen from '../screens/Members/SignupScreen';
import ForgotScreen from '../screens/Members/ForgotScreen';
import ProfileScreen from '../screens/Members/ProfileScreen';
import PortfolioScreen from '../screens/Portfolio/PortfolioScreen';
import CapitalScreen from '../screens/Capital/CapitalScreen';
import NotFoundScreen from '../screens/NotFound/NotFoundScreen';
import DashboardScreen from '../screens/Dashboard/DashboardScreen';
import TransactionsScreen from '../screens/Transactions/TransactionsScreen';
import GXTerminalScreen from '../screens/GXTerminal/GXTerminalScreen';

const Navigation: React.FC = () => (
  <Routes>
    <Route path='/' element={<GXTerminalScreen />} />
    <Route path='/market' element={<GXTerminalScreen />} />
    <Route path='/profile' element={<ProfileScreen />} />
    <Route path='/members' element={<Navigate to='/portfolio' replace />} />
    <Route path='/portfolio' element={<PortfolioScreen />} />
    <Route path='/capital' element={<CapitalScreen />} />
    <Route path='/dashboard' element={<DashboardScreen />} />
    <Route path='/members/signup' element={<SignupScreen />} />
    <Route path='/transactions' element={<TransactionsScreen />} />
    <Route path='/members/forgot-password' element={<ForgotScreen />} />
    <Route path='/splash' element={<SplashScreen />} />
    <Route path='*' element={<NotFoundScreen />} />
  </Routes>
);

export default Navigation;
