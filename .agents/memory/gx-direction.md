---
name: GX Telegram gift exchange
description: Durable product direction for the imported React exchange project.
---

The product direction is a Bybit/Binance-style exchange for collectible Telegram gifts, delivered as a Telegram Mini App and branded GX. The immediate priority is the trading interface, not live payments or a complete backend.

Core product decisions:
- Use an existing open-source exchange UI as inspiration/base where licensing permits; do not rebuild the trading interface from scratch unnecessarily.
- Adapt the current crypto exchange template toward a dark, professional exchange experience with watchlist/market selection, charts, order book, buy/sell order form, portfolio/balance, and transaction history.
- Telegram gifts are the traded assets; the internal account currency is GX.
- Planned funding includes Telegram Stars and USDT.
- Planned withdrawals are crypto-only, using Telegram bot flows.
- Telegram Bot Token is available to the user, but secrets must remain in Replit's secret storage and must not be written into source files.
- Integrations with Telegram, gift marketplaces, wallet/TON, Stars, USDT, and withdrawal bots are later phases unless the user explicitly asks to implement them now.

**Why:** The user explicitly prioritized first creating/adapting the interface and avoiding a from-scratch build; payment, custody, and trading automation need separate product and security decisions later.

**How to apply:** For future UI work, preserve the current React/TypeScript stack unless there is a clear reason to change it, use GX terminology, and treat data as mock/demo data until a specific backend and integration scope is approved.