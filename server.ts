process.env.RUN_MIGRATIONS = 'true';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer, Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

import { initDbSchema } from './server/dbSchema';
import { getPgPool } from './server/marketRepository';
import { isPostgresConfigured } from './server/dbConfig';
import { getExpressCorsOptions, getSocketCorsOptions } from './server/corsConfig';
import { initMarketStateRepository, getMarketRepository } from './server/marketState';
import { PostgresTradingEngine } from './server/tradingEngine';
import { initRealtimeManager } from './server/realtimeManager';
import { closeRedisConnections } from './server/redisManager';
import { initOutboxWorker, stopOutboxWorker } from './server/outboxWorker';
import { startTradingOutboxWorker, stopTradingOutboxWorker } from './server/tradingOutboxWorker';
import { startWithdrawalWorker, stopWithdrawalWorker } from './server/withdrawalWorker';
import { TonScanner } from './server/tonScanner';
import { startGiftSyncWorker } from './server/giftSyncWorker';
import { simulateSales } from './server/mockMinter';
import { errorLogger } from './server/errorLogger';
import { restApiRateLimiter, requestTimeoutMiddleware } from './server/rateLimiter';

import financialRoutes from './server/routes/financialRoutes';
import marketRoutes from './server/routes/marketRoutes';
import systemRoutes from './server/routes/systemRoutes';
import { setupSocketServer } from './server/socketServer';

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Global Middlewares
app.use(cors(getExpressCorsOptions()));
app.use(express.json({ limit: '100kb' }));
app.use(requestTimeoutMiddleware(30000));
app.use(errorLogger);

// REST API Rate Limiter
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/telegram/webhook') || req.path.startsWith('/sales/ingest')) {
    return next();
  }
  return restApiRateLimiter(req, res, next);
});

// Modular Routes Registration
app.use('/api', financialRoutes);
app.use('/api', marketRoutes);
app.use(systemRoutes);

// Database Bootstrap
async function setupDatabaseSchema() {
  if (!isPostgresConfigured()) {
    console.log('[DB Setup] PostgreSQL not configured. Skipping schema bootstrap.');
    return;
  }
  try {
    const pool = getPgPool();
    await initDbSchema(pool);
    console.log('[DB Setup] Ensured all TE tables and schemas exist.');
  } catch (err: any) {
    console.warn('[DB Setup] Skipped or error:', err?.message);
  }
}
setupDatabaseSchema().catch((err) => {
  console.error('[DB Setup] Critical Error:', err);
});

// Singletons & Accessors
let tradingEngineInstance: PostgresTradingEngine | null = null;
export const getTradingEngine = (): PostgresTradingEngine => {
  if (!tradingEngineInstance) {
    tradingEngineInstance = new PostgresTradingEngine(getPgPool());
  }
  return tradingEngineInstance;
};

// Express error handling for Payload Too Large and CORS blocked errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res
      .status(413)
      .json({ error: 'Payload Too Large: Maximum JSON payload size is 100kb.' });
  }
  if (err && typeof err.message === 'string' && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({ error: err.message });
  }
  next(err);
});

let httpServerRef: HttpServer | null = null;
let ioRef: Server | null = null;
let isShuttingDown = false;

export async function stopServerGracefully(signal = 'SIGTERM'): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Received ${signal}. Executing graceful shutdown sequence...`);

  try {
    stopOutboxWorker();
    stopTradingOutboxWorker();
    stopWithdrawalWorker();
    console.log('[Server] OutboxWorker and WithdrawalWorker stopped.');
  } catch (e) {
    console.error('[Server] Error stopping OutboxWorker/WithdrawalWorker:', e);
  }

  if (ioRef) {
    try {
      ioRef.close();
      console.log('[Server] Socket.io server closed.');
    } catch (e) {
      console.error('[Server] Error closing Socket.io:', e);
    }
  }

  if (httpServerRef) {
    await new Promise<void>((resolve) => {
      httpServerRef?.close(() => {
        console.log('[Server] HTTP listener stopped.');
        resolve();
      });
    });
  }

  try {
    await closeRedisConnections();
  } catch (e) {
    console.error('[Server] Error closing Redis connections:', e);
  }

  try {
    const repo = getMarketRepository() as any;
    if (repo && typeof repo.close === 'function') {
      await repo.close();
      console.log('[Server] Database pool closed.');
    }
  } catch (e) {
    console.error('[Server] Error closing database pool:', e);
  }

  console.log('[Server] Graceful shutdown completed.');
}

process.on('SIGTERM', () => {
  stopServerGracefully('SIGTERM').then(() => process.exit(0));
});

process.on('SIGINT', () => {
  stopServerGracefully('SIGINT').then(() => process.exit(0));
});

async function startServer() {
  await setupDatabaseSchema();
  initMarketStateRepository();
  initOutboxWorker(getMarketRepository());

  const engine = getTradingEngine();

  const httpServer = createServer(app);
  httpServerRef = httpServer;

  const io = new Server(httpServer, {
    cors: getSocketCorsOptions(),
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 10000,
  });
  ioRef = io;

  // Realtime Manager & Socket Server Handlers
  initRealtimeManager(io);
  setupSocketServer(io, engine);

  if (process.env.SIMULATION_MODE === 'true' || process.env.ENABLE_SIMULATION === 'true') {
    simulateSales(io);
  }

  // Background Workers
  if (isPostgresConfigured()) {
    startTradingOutboxWorker(getPgPool(), io);
    startWithdrawalWorker(getPgPool());
    const tonScanner = new TonScanner(getPgPool());
    tonScanner.start();
  }

  startGiftSyncWorker();

  // Vite Development / Production Static Server
  if (
    process.env.NO_VITE !== 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test'
  ) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`GX Exchange Server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}
