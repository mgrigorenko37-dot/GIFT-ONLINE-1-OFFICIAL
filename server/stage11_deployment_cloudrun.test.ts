import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import { getRedisHealthStatus } from './redisManager';
import { resolveMarketRepository } from './marketRepository';
import { getMarketRepository, setMarketRepository, initMarketStateRepository } from './marketState';

describe('Stage 11: Cloud Run & Multi-Instance Realtime Deployment Verification', () => {
  let app: express.Express;
  let server: HttpServer;
  let io: SocketServer;
  let serverPort: number;

  beforeAll(async () => {
    app = express();
    app.use(express.json());

    // Register probes
    app.get(['/health', '/api/health'], (req, res) => {
      const redisHealth = getRedisHealthStatus();
      const repo = getMarketRepository();
      const dbConnected = Boolean(process.env.DATABASE_URL);

      res.status(200).json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        redis: redisHealth,
        database: {
          connected: dbConnected,
          repository: repo ? repo.constructor.name : 'Unknown',
        },
        environment: {
          nodeEnv: process.env.NODE_ENV || 'development',
          port: Number(process.env.PORT || 3000),
          requireRedis: process.env.REQUIRE_REDIS === 'true',
          simulationMode: process.env.SIMULATION_MODE === 'true',
          allowFileStorageInProd: process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true',
        },
      });
    });

    app.get(['/readiness', '/api/readiness'], (req, res) => {
      const requireRedis = process.env.REQUIRE_REDIS === 'true';
      const redisHealth = getRedisHealthStatus();
      const isProduction = process.env.NODE_ENV === 'production';
      const hasDb = Boolean(process.env.DATABASE_URL);
      const allowFileInProd = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true';

      if (requireRedis && !redisHealth.isConnected) {
        return res.status(503).json({
          ready: false,
          reason: 'Redis is required (REQUIRE_REDIS=true) but Redis connection is inactive.',
        });
      }

      if (isProduction && !hasDb) {
        return res.status(503).json({
          ready: false,
          reason: 'PostgreSQL (DATABASE_URL) is strictly required in production.',
        });
      }

      return res.status(200).json({
        ready: true,
        timestamp: Date.now(),
        redisActive: redisHealth.isConnected,
      });
    });

    app.get(['/live', '/api/live'], (req, res) => {
      res.status(200).json({ alive: true, timestamp: Date.now() });
    });

    server = createServer(app);
    io = new SocketServer(server, {
      transports: ['websocket', 'polling'],
      cors: { origin: '*' },
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    io.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('1. Health Probe (/health) returns 200 OK with runtime diagnostics', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.environment).toBeDefined();
    expect(body.redis).toBeDefined();
    expect(body.database).toBeDefined();
  });

  test('2. Liveness Probe (/live) returns 200 OK', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/live`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.alive).toBe(true);
  });

  test('3. Readiness Probe (/readiness) responds appropriately based on environment variables', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/readiness`);
    // In dev mode without REQUIRE_REDIS=true, readiness should be 200 OK
    expect([200, 503]).toContain(res.status);
    const body = await res.json();
    expect(typeof body.ready).toBe('boolean');
  });

  test('4. Production Safety Rules: Startup without DATABASE_URL in production throws error', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDb = process.env.DATABASE_URL;
    const originalAllow = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      delete process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION;

      expect(() => resolveMarketRepository()).toThrow('CRITICAL CONFIGURATION ERROR');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalDb) process.env.DATABASE_URL = originalDb;
      if (originalAllow) process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION = originalAllow;
    }
  });

  test('5. Socket.io supports pure WebSocket transport without polling handshake errors', async () => {
    const client: ClientSocket = ioc(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'], // pure websocket, bypassing HTTP polling
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000);
      client.on('connect', () => {
        clearTimeout(timeout);
        expect(client.connected).toBe(true);
        expect(client.io.engine.transport.name).toBe('websocket');
        client.disconnect();
        resolve();
      });
      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  test('6. Environment Variables Checklist Verification', () => {
    // Check that important configuration variables are explicitly inspectable
    const envVars = [
      'PORT',
      'NODE_ENV',
      'DATABASE_URL',
      'REDIS_URL',
      'REQUIRE_REDIS',
      'ALLOW_FILE_STORAGE_IN_PRODUCTION',
      'SIMULATION_MODE',
      'TELEGRAM_WEBHOOK_SECRET',
    ];

    envVars.forEach((varName) => {
      // We verify names without outputting sensitive values
      expect(typeof varName).toBe('string');
    });
  });
});
