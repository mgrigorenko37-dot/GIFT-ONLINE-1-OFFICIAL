import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

window.addEventListener('error', (e) => {
  if (
    e.message === 'ResizeObserver loop limit exceeded' ||
    e.message === 'ResizeObserver loop completed with undelivered notifications.'
  ) {
    e.stopImmediatePropagation();
  }
});

window.addEventListener('unhandledrejection', (e) => {
  if (
    e.reason &&
    (e.reason.message?.includes('WebSocket closed') ||
      e.reason.message?.includes('analytics API error') ||
      e.reason.toString().includes('Failed to send analytics events'))
  ) {
    e.preventDefault();
  }
});

const originalConsoleError = console.error;
console.error = (...args) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('[TON_CONNECT_SDK]') || args[0].includes('analytics events'))
  ) {
    return;
  }
  originalConsoleError(...args);
};

const getManifestUrl = () => {
  try {
    if (
      typeof window !== 'undefined' &&
      window.location &&
      window.location.origin &&
      window.location.origin !== 'null' &&
      (window.location.origin.startsWith('http://') ||
        window.location.origin.startsWith('https://'))
    ) {
      return `${window.location.origin}/tonconnect-manifest.json`;
    }
  } catch (_) {}
  return '/tonconnect-manifest.json';
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <ErrorBoundary>
    <TonConnectUIProvider manifestUrl={getManifestUrl()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </TonConnectUIProvider>
  </ErrorBoundary>
);
