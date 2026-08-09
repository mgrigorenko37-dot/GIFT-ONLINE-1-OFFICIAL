import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { RedisOptions } from 'ioredis';
import { AcceptSaleResult } from './marketState';
import { FloorResult } from './floorManager';

export const MARKET_EVENTS_CHANNEL = 'market:events_pubsub';
export const REDIS_SEQUENCE_KEY = 'market:global_sequence';

let pubClient: Redis | null = null;
let subClient: Redis | null = null;
let isConnected = false;
let fallbackLocalSequence = 0;

export interface RedisManagerConfig {
  redisUrl?: string;
  multiInstanceMode?: boolean;
  requireRedis?: boolean;
}

export function isRedisActive(): boolean {
  return isConnected && pubClient !== null && pubClient.status === 'ready';
}

export function getRedisHealthStatus(): { status: 'healthy' | 'unhealthy' | 'disabled'; isConnected: boolean; isRequired: boolean } {
  const isRequireRedis = process.env.REQUIRE_REDIS === 'true';
  if (!pubClient) {
    return {
      status: isRequireRedis ? 'unhealthy' : 'disabled',
      isConnected: false,
      isRequired: isRequireRedis,
    };
  }
  const healthy = isRedisActive();
  return {
    status: healthy ? 'healthy' : 'unhealthy',
    isConnected: healthy,
    isRequired: isRequireRedis,
  };
}

export function getPubClient(): Redis | null {
  return pubClient;
}

export async function getNextGlobalSequence(): Promise<number> {
  if (isRedisActive() && pubClient) {
    try {
      const seq = await pubClient.incr(REDIS_SEQUENCE_KEY);
      return seq;
    } catch (err) {
      console.warn('[RedisManager] Redis INCR sequence failed, using local sequence fallback:', err);
    }
  }
  return ++fallbackLocalSequence;
}

export function setFallbackSequence(val: number) {
  fallbackLocalSequence = val;
}

export function resetLocalSequence(val: number = 0) {
  fallbackLocalSequence = val;
}

type MarketEventHandler = (event: any) => void;
const marketEventHandlers: MarketEventHandler[] = [];

export function onRedisMarketEvent(handler: MarketEventHandler) {
  marketEventHandlers.push(handler);
  return () => {
    const idx = marketEventHandlers.indexOf(handler);
    if (idx !== -1) marketEventHandlers.splice(idx, 1);
  };
}

export function initRedisManager(io?: Server, config?: RedisManagerConfig): { success: boolean; mode: 'multi-instance' | 'single-instance' } {
  const redisUrl = config?.redisUrl || process.env.REDIS_URL;
  const isMultiInstance = config?.multiInstanceMode || process.env.MULTI_INSTANCE_MODE === 'true' || process.env.NODE_ENV === 'production';
  const isRequireRedis = config?.requireRedis || process.env.REQUIRE_REDIS === 'true';

  if (!redisUrl) {
    const warnMsg = '[RedisManager] WARNING: Redis is not configured. Realtime multi-instance mode is disabled.';
    console.warn(warnMsg);

    if (isRequireRedis) {
      throw new Error('CRITICAL CONFIGURATION ERROR: REDIS_URL is strictly required for multi-instance deployment (REQUIRE_REDIS=true).');
    }

    return { success: false, mode: 'single-instance' };
  }

  try {
    const redisOptions: RedisOptions = {
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 3000);
        console.warn(`[RedisManager] Redis connection retry attempt #${times} in ${delay}ms...`);
        return delay;
      },
      reconnectOnError(err) {
        console.warn('[RedisManager] Redis reconnectOnError trigger:', err.message);
        return true;
      }
    };

    pubClient = new Redis(redisUrl, redisOptions);
    subClient = pubClient.duplicate();

    pubClient.on('connect', () => {
      console.log('[RedisManager] Redis pubClient connected successfully.');
    });

    pubClient.on('ready', () => {
      isConnected = true;
      console.log('[RedisManager] Redis pubClient ready.');
    });

    pubClient.on('close', () => {
      isConnected = false;
      console.warn('[RedisManager] Redis pubClient connection closed.');
    });

    pubClient.on('reconnecting', () => {
      isConnected = false;
      console.warn('[RedisManager] Redis pubClient reconnecting...');
    });

    pubClient.on('error', (err) => {
      console.error('[RedisManager] Redis pubClient connection error:', err.message);
      isConnected = false;
    });

    subClient.on('error', (err) => {
      console.error('[RedisManager] Redis subClient connection error:', err.message);
    });

    // Attach Socket.io Redis Adapter if io instance provided
    if (io && pubClient && subClient) {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[RedisManager] Socket.io Redis Adapter attached successfully.');
    }

    // Subscribe to market events channel
    subClient.subscribe(MARKET_EVENTS_CHANNEL, (err, count) => {
      if (err) {
        console.error('[RedisManager] Failed to subscribe to market events channel:', err);
      } else {
        console.log(`[RedisManager] Subscribed to channel ${MARKET_EVENTS_CHANNEL}. Subscribed count: ${count}`);
      }
    });

    subClient.on('message', (channel, message) => {
      if (channel === MARKET_EVENTS_CHANNEL) {
        try {
          const payload = JSON.parse(message);
          for (const handler of marketEventHandlers) {
            try {
              handler(payload);
            } catch (hErr) {
              console.error('[RedisManager] Error in market event handler:', hErr);
            }
          }
        } catch (pErr) {
          console.error('[RedisManager] Failed to parse Redis market event JSON:', pErr);
        }
      }
    });

    return { success: true, mode: 'multi-instance' };
  } catch (err: any) {
    console.error('[RedisManager] Failed to initialize Redis Clients:', err.message);
    if (isRequireRedis) {
      throw err;
    }
    return { success: false, mode: 'single-instance' };
  }
}

export async function publishMarketEventToRedis(payload: any): Promise<boolean> {
  if (!isRedisActive() || !pubClient) {
    return false;
  }

  try {
    const json = JSON.stringify(payload);
    await pubClient.publish(MARKET_EVENTS_CHANNEL, json);
    return true;
  } catch (err: any) {
    console.error('[RedisManager] Error publishing market event to Redis:', err.message);
    return false;
  }
}

export async function closeRedisConnections(): Promise<void> {
  isConnected = false;
  if (pubClient) {
    await pubClient.quit().catch(() => pubClient?.disconnect());
    pubClient = null;
  }
  if (subClient) {
    await subClient.quit().catch(() => subClient?.disconnect());
    subClient = null;
  }
  console.log('[RedisManager] Redis connections closed.');
}

export function setTestRedisClients(pub: any, sub?: any) {
  pubClient = pub;
  subClient = sub || pub;
  if (pubClient) {
    isConnected = pubClient.status === 'ready';
    pubClient.on('ready', () => { isConnected = true; });
    pubClient.on('close', () => { isConnected = false; });
    pubClient.on('reconnecting', () => { isConnected = false; });
    pubClient.on('error', () => { isConnected = false; });
  } else {
    isConnected = false;
  }
}
