# GX Exchange — Telegram Gift Trading Mini App

## Project Overview

**GX Exchange** is a high-performance Telegram Mini App and trading terminal designed for fractional and whole collectible Telegram Gifts trading. The project features a React 19 frontend, Express 5 full-stack server (`server.ts`), real-time Socket.IO communication, PostgreSQL ACID trading persistence, Telegram HMAC authentication, Telegram Stars payment processing, TON deposit tracking, and a withdrawal state machine.

---

## Architecture & Implemented Modules

### 1. Implemented Modules

- **Express 5 Backend & Server Entry (`server.ts`)**: Serves REST endpoints and integrates Vite middleware in development mode, while providing static file serving for production builds.
- **PostgreSQL Database & Trading Engine (`PostgresTradingEngine`)**:
  - Handles ACID atomic order matching, balance reservation, position updates, margin management, and PnL calculations across `te_orders`, `te_executions`, `te_positions`, and `te_balances`.
  - Database schema runner (`server/db/migrateRunner.ts`) for applying migrations.
  - Multi-currency isolation (`TON`, `STARS`, `GX`).
- **Telegram HMAC Authentication (`server/telegramAuth.ts`)**:
  - Validates `Telegram.WebApp.initData` cryptographic signatures via HMAC-SHA256 to prevent user impersonation.
- **Telegram Stars Invoices & Payment Lifecycle (`invoiceService.ts`)**:
  - Server-authoritative invoice generation and pre-storage in `te_invoices`.
  - Webhook handler (`/api/telegram/payment-webhook`) with `SELECT ... FOR UPDATE` row locks, idempotency checks, and atomic `STARS` balance crediting in `te_payments` and `te_balances`.
- **TON Deposit Scanner (`TonScanner`)**:
  - Cursor-based Logical Time (`lt`) blockchain scanning via TonAPI.
  - Verification of sender wallet addresses against registered user records (`te_users`).
  - Idempotent deposit crediting with outbox notification events.
- **Withdrawal State Machine & Worker (`server/withdrawalWorker.ts`)**:
  - Multi-stage withdrawal state machine (`PENDING` -> `PROCESSING` -> `COMPLETED` / `NEEDS_RECONCILIATION` / `FAILED`) with balance locking and idempotency against double-withdrawals.
- **Realtime Socket.IO Communication**:
  - Live order book streaming, trade execution events, candlestick updates, and optional Redis Pub/Sub adapter clustering (`@socket.io/redis-adapter`).

---

## Development & Mock Modes

- **Local / Test Database Fallback**: In development or testing environments when `DATABASE_URL` is omitted, fallback configurations or test mock adapters (e.g., `MockTonTransferAdapter`) can be utilized. In production (`NODE_ENV=production`), PostgreSQL (`DATABASE_URL`) is strictly required and file-based storage is strictly prohibited.
- **Browser Preview Fallback**: When opened outside the Telegram WebApp iframe, the frontend uses a clearly labeled browser-preview mode with mock Telegram user profiles.
- **TON Scanner & Withdrawal Test Mocks**: The test suite includes mock TON adapters (`MockTonTransferAdapter`, `FaultInjectionTonAdapter`) for unit and integration testing without live on-chain dependencies.

---

## Production Prerequisites & Secrets Management

To run GX Exchange in production, the following environment variables must be configured:

- `DATABASE_URL`: PostgreSQL connection string (strictly required in production mode).
- `TELEGRAM_BOT_TOKEN`: Bot token for validating `initData` HMAC and issuing Telegram Stars invoices.
- `EXCHANGE_HOT_WALLET_ADDRESS`: TON hot wallet address for deposit scanning and withdrawals.
- `ALLOWED_ORIGINS`: Comma-separated CORS allowed origins.

> **Security Note**: All secrets (bot tokens, database connection strings, private keys, API keys) MUST be stored exclusively in environment variables or Replit Secrets. Never place sensitive credentials in source code or client-side assets.

---

## Items Requiring Further Setup or Verification

- Registering the deployed HTTPS WebApp URL with Telegram BotFather.
- Provisioning a production PostgreSQL instance and running database migrations (`npm run db:migrate`).
- Verifying the TON Hot Wallet configuration, TonAPI RPC key/rate limits, and hot wallet balance before enabling live withdrawal processing.

---

## Environment & Development Commands

- `npm run dev`: Starts the development server using `tsx server.ts` (Express server with Vite development middleware on port 3000).
- `npm run build`: Builds the production frontend bundle via Vite (`vite build`) and bundles the backend server via esbuild into `dist/server.cjs`.
- `npm start`: Starts the production server using Node.js (`node dist/server.cjs`).
- `npm run typecheck`: Runs TypeScript type checking without emitting files (`tsc --noEmit`).
- `npm run test:unit`: Runs unit test suite via Vitest (`server/*.test.ts src/**/*.test.ts`).
- `npm run test:integration`: Runs integration test suite via Vitest (`tests/integration/*.test.ts`).
- `npm run db:migrate`: Executes database schema migrations (`tsx server/db/migrateRunner.ts`).
