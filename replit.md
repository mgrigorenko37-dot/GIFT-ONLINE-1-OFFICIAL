# GX Exchange — Telegram Gift Trading Mini App

## Project overview

This project is a React and TypeScript frontend for GX, a Telegram Mini App concept for trading collectible Telegram gifts with an internal GX balance. The main route is a dark exchange terminal with gift markets, chart, order book, buy/sell form, portfolio links, and responsive mobile behavior.

The current gift prices, orders, balances, and order submission are demo data. No custody, real trading, Telegram Stars, USDT, withdrawal bot, or backend API is configured yet.

## Telegram Mini App support

The frontend loads Telegram's official Web Apps bridge from `https://telegram.org/js/telegram-web-app.js`. When opened inside Telegram it:

- calls `ready()` and `expand()`;
- reads the Telegram theme and applies it to the app;
- reads the Telegram user profile for the account display;
- uses Telegram safe-area viewport metadata through the responsive layout.

When opened directly in a browser, it uses a clearly labeled browser-preview fallback and demo profile data.

To launch this as a real Mini App, the deployed HTTPS URL must be registered with a Telegram bot as its Web App URL. The bot token must stay server-side in Replit Secrets; it must never be placed in React code or `public/`.

The next backend phase must validate `Telegram.WebApp.initData` on the server before trusting the Telegram user, then add the bot, Stars, USDT, wallet, and gift marketplace integrations.

## Running on Replit

The project runs with the `Start application` workflow:

```bash
BROWSER=none HOST=0.0.0.0 PORT=5000 npm start
```

This runs `vite` (see `vite.config.ts`), which serves the React development app on port 5000 for the Replit preview. The project was migrated from `react-scripts` (CRA) to Vite to resolve dependency incompatibilities with Node.js 20.

The Telegram bot runs with the `Telegram bot` workflow:

```bash
npm run bot
```

It uses the `BOT_TOKEN` secret and opens the Mini App at `WEB_APP_URL`, or at the
current Replit development domain when `WEB_APP_URL` is not set. The bot supports
`/start`, `/app`, and `/help`. For a real Telegram Mini App, set `WEB_APP_URL` to
the deployed HTTPS URL and configure that URL through BotFather.

## User preferences

- Keep the existing React and TypeScript structure and dependencies unless a requested feature requires otherwise.
