import { useEffect, useState } from 'react';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

interface TelegramThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramUser };
  colorScheme: 'light' | 'dark';
  version: string;
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  openInvoice: (
    url: string,
    callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void
  ) => void;
  onEvent: (eventType: string, callback: () => void) => void;
  offEvent: (eventType: string, callback: () => void) => void;
}

interface TelegramGlobal {
  WebApp: TelegramWebApp;
}

declare global {
  interface Window {
    Telegram?: TelegramGlobal;
  }
}

const getTelegramWebApp = () => window.Telegram?.WebApp;

const supportsVersion = (webApp: TelegramWebApp, minimum: string) => {
  const current = webApp.version.split('.').map(Number);
  const required = minimum.split('.').map(Number);

  return (
    current[0] > required[0] ||
    (current[0] === required[0] && (current[1] ?? 0) >= (required[1] ?? 0))
  );
};

const applyTelegramTheme = (webApp: TelegramWebApp) => {
  const root = document.documentElement;
  const theme = webApp.themeParams;

  root.style.setProperty('--tg-bg-color', theme.bg_color ?? '#0e0d15');
  root.style.setProperty('--tg-secondary-bg-color', theme.secondary_bg_color ?? '#15131e');
  root.style.setProperty('--tg-text-color', theme.text_color ?? '#f5f2fc');
  root.style.setProperty('--tg-hint-color', theme.hint_color ?? '#908c9e');
  root.style.setProperty('--tg-link-color', theme.link_color ?? '#a990ff');
  root.style.setProperty('--tg-button-color', theme.button_color ?? '#9078ff');
};

export const useTelegramWebApp = () => {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<TelegramUser | null>(null);

  useEffect(() => {
    const telegramWebApp = getTelegramWebApp();

    if (!telegramWebApp) {
      return undefined;
    }

    const handleThemeChanged = () => applyTelegramTheme(telegramWebApp);

    telegramWebApp.ready();
    telegramWebApp.expand();
    if (supportsVersion(telegramWebApp, '6.1')) {
      telegramWebApp.setHeaderColor('#0e0d15');
      telegramWebApp.setBackgroundColor('#0e0d15');
    }
    if (supportsVersion(telegramWebApp, '7.6')) {
      telegramWebApp.setBottomBarColor?.('#0e0d15');
    }
    applyTelegramTheme(telegramWebApp);
    telegramWebApp.onEvent('themeChanged', handleThemeChanged);

    setWebApp(telegramWebApp);
    setUser(telegramWebApp.initDataUnsafe.user ?? null);

    return () => telegramWebApp.offEvent('themeChanged', handleThemeChanged);
  }, []);

  return {
    isTelegram: webApp !== null,
    webApp,
    openInvoice: webApp?.openInvoice ?? (() => {}),
    user,
  };
};
