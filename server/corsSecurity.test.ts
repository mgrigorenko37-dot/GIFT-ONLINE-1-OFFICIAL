import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientSocketIO, Socket as ClientSocket } from 'socket.io-client';
import {
  parseAllowedOrigins,
  isOriginAllowed,
  getExpressCorsOptions,
  getSocketCorsOptions,
} from './corsConfig';

describe('CORS Security and Policy Verification', () => {
  let origEnv: NodeJS.ProcessEnv;
  let app: express.Express;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let serverPort: number;

  beforeEach(async () => {
    origEnv = { ...process.env };
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    if (ioServer) {
      ioServer.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  function setupTestServer() {
    app = express();
    app.use(cors(getExpressCorsOptions()));
    app.use(express.json());

    app.get('/api/test', (req, res) => {
      res.json({ success: true, message: 'API accessible' });
    });

    app.post('/api/telegram/webhook', (req, res) => {
      res.json({ received: true, body: req.body });
    });

    // Express error handling for CORS blocked errors
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err && typeof err.message === 'string' && err.message.startsWith('CORS blocked')) {
        return res.status(403).json({ error: err.message });
      }
      next(err);
    });

    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, {
      cors: getSocketCorsOptions(),
      transports: ['websocket', 'polling'],
    });

    ioServer.use((socket, next) => {
      // Mock simple demo/auth for socket test
      next();
    });

    ioServer.on('connection', (socket) => {
      socket.emit('ready', { socketId: socket.id });
    });

    return new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  }

  describe('1. Parsing and Origin Validation Rules', () => {
    it('parses comma-separated allowed origins cleanly with spaces and trailing slashes', () => {
      const parsed = parseAllowedOrigins(
        'https://app.exchange.com/,  https://web.telegram.org , https://webk.telegram.org/ '
      );
      expect(parsed).toEqual([
        'https://app.exchange.com',
        'https://web.telegram.org',
        'https://webk.telegram.org',
      ]);
    });

    it('returns empty array when ALLOWED_ORIGINS is undefined or empty', () => {
      expect(parseAllowedOrigins(undefined)).toEqual([]);
      expect(parseAllowedOrigins('')).toEqual([]);
      expect(parseAllowedOrigins('   ')).toEqual([]);
    });

    it('in production: allows only explicitly listed origins', () => {
      const allowed = ['https://exchange.com', 'https://web.telegram.org'];
      expect(isOriginAllowed('https://exchange.com', allowed, true)).toBe(true);
      expect(isOriginAllowed('https://web.telegram.org', allowed, true)).toBe(true);
      expect(isOriginAllowed('https://evil-hacker.com', allowed, true)).toBe(false);
      expect(isOriginAllowed('http://localhost:3000', allowed, true)).toBe(false);
      expect(isOriginAllowed('https://exchange.com.fake.com', allowed, true)).toBe(false);
    });

    it('in production: empty allowlist blocks all browser origins (no wildcards)', () => {
      expect(isOriginAllowed('https://anydomain.com', [], true)).toBe(false);
      expect(isOriginAllowed('http://localhost:3000', [], true)).toBe(false);
    });

    it('in development/test: localhost and 127.0.0.1 on any port are permitted', () => {
      expect(isOriginAllowed('http://localhost:3000', [], false)).toBe(true);
      expect(isOriginAllowed('http://localhost:5173', [], false)).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:4173', [], false)).toBe(true);
      expect(isOriginAllowed('http://localhost:8080', [], false)).toBe(true);
      expect(isOriginAllowed('https://evil.com', [], false)).toBe(false);
    });

    it('missing origin (!origin) is always permitted for server-to-server and webhooks', () => {
      expect(isOriginAllowed(undefined, [], true)).toBe(true);
      expect(isOriginAllowed('', [], true)).toBe(true);
    });
  });

  describe('2. Express REST API CORS Execution', () => {
    it('allows request and sets CORS headers when Origin is in ALLOWED_ORIGINS', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://trusted-app.com,https://web.telegram.org';
      await setupTestServer();

      const res = await fetch(`http://127.0.0.1:${serverPort}/api/test`, {
        headers: {
          Origin: 'https://trusted-app.com',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://trusted-app.com');
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('handles preflight OPTIONS request for allowed origin with 204 status', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://trusted-app.com';
      await setupTestServer();

      const res = await fetch(`http://127.0.0.1:${serverPort}/api/test`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://trusted-app.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,x-telegram-init-data',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://trusted-app.com');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('rejects forbidden origin in production with 403 status', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://trusted-app.com';
      await setupTestServer();

      const res = await fetch(`http://127.0.0.1:${serverPort}/api/test`, {
        headers: {
          Origin: 'https://evil-phishing-site.com',
        },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('CORS blocked: Origin https://evil-phishing-site.com');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows server-to-server webhook request without Origin header', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://trusted-app.com';
      await setupTestServer();

      const res = await fetch(`http://127.0.0.1:${serverPort}/api/telegram/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // No Origin header sent (typical for Telegram Bot webhook servers)
        },
        body: JSON.stringify({ update_id: 123456 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.received).toBe(true);
      expect(data.body.update_id).toBe(123456);
    });

    it('allows localhost origin in development mode even if ALLOWED_ORIGINS is not set', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ALLOWED_ORIGINS;
      await setupTestServer();

      const res = await fetch(`http://127.0.0.1:${serverPort}/api/test`, {
        headers: {
          Origin: 'http://localhost:5173',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    });
  });

  describe('3. Socket.IO Handshake CORS Validation', () => {
    it('successfully connects Socket.IO client from allowed origin', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://trusted-app.com';
      await setupTestServer();

      const client: ClientSocket = ClientSocketIO(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket', 'polling'],
        extraHeaders: {
          Origin: 'https://trusted-app.com',
        },
      });

      const readyData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.disconnect();
          reject(new Error('Socket connection timed out for allowed origin'));
        }, 5000);

        client.on('ready', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });

        client.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(readyData).toBeDefined();
      expect(readyData.socketId).toBeDefined();
      client.disconnect();
    });

    it('rejects Socket.IO connection from unauthorized origin in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://trusted-app.com';
      await setupTestServer();

      const client: ClientSocket = ClientSocketIO(`http://127.0.0.1:${serverPort}`, {
        transports: ['polling'],
        extraHeaders: {
          Origin: 'https://malicious-site.com',
        },
      });

      const errorOccurred = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          client.disconnect();
          resolve(false);
        }, 3000);

        client.on('connect_error', (err) => {
          clearTimeout(timeout);
          client.disconnect();
          resolve(true);
        });

        client.on('ready', () => {
          clearTimeout(timeout);
          client.disconnect();
          resolve(false);
        });
      });

      expect(errorOccurred).toBe(true);
    });

    it('allows Socket.IO connection without Origin header (e.g. backend service client)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://trusted-app.com';
      await setupTestServer();

      const client: ClientSocket = ClientSocketIO(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
      });

      const readyData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.disconnect();
          reject(new Error('Socket connection without origin timed out'));
        }, 5000);

        client.on('ready', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });

        client.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(readyData).toBeDefined();
      client.disconnect();
    });
  });
});
