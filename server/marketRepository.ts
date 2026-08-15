import { GiftSale, GiftCandle, Timeframe } from './chartEngine';
import fs from 'fs';
import path from 'path';
import { Pool, PoolConfig } from 'pg';

declare global {
  var _postgresPool: Pool | undefined;
}

export interface MarketSnapshot {
  version: number;
  timestamp: number;
  allSales: GiftSale[];
  processedSaleIds: string[];
  activeCandles: Record<string, Record<string, GiftCandle>>;
  closedCandles: Record<string, Record<string, GiftCandle[]>>;
  isSimulation?: boolean;
}

export interface OutboxEvent {
  id?: number;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  instrumentKey: string;
  timeframe?: string;
  payload: any;
  sequence?: number;
  status: 'pending' | 'processing' | 'published' | 'failed';
  attempts: number;
  availableAt: number;
  lockedAt?: number;
  publishedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IMarketRepository {
  saveSnapshot(snapshot: MarketSnapshot): Promise<void> | void;
  loadSnapshot(): Promise<MarketSnapshot | null> | MarketSnapshot | null;
  saveSale(sale: GiftSale): Promise<void> | void;
  getSales(): Promise<GiftSale[]> | GiftSale[];
  saveCandles(
    instrumentKey: string,
    timeframe: Timeframe,
    candles: GiftCandle[]
  ): Promise<void> | void;
  getCandles(
    instrumentKey: string,
    timeframe: Timeframe,
    options?: { from?: number; to?: number; limit?: number }
  ): Promise<GiftCandle[]> | GiftCandle[];
  clear(): Promise<void> | void;
  saveSaleAndCandlesAtomic?(
    sale: GiftSale,
    candles: GiftCandle[],
    outboxEvents?: OutboxEvent[]
  ): Promise<{ isNew: boolean }>;

  saveOutboxEvent?(event: OutboxEvent): Promise<void>;
  fetchPendingOutboxEvents?(limit?: number, lockLeaseMs?: number): Promise<OutboxEvent[]>;
  markOutboxEventPublished?(eventId: string, publishedAt?: number): Promise<void>;
  markOutboxEventFailed?(
    eventId: string,
    errorMsg: string,
    nextAvailableAt?: number
  ): Promise<void>;
  getOutboxEventById?(eventId: string): Promise<OutboxEvent | null>;
}

/**
 * Default In-Memory Repository for fast ephemeral operations and unit testing.
 */
export class InMemoryMarketRepository implements IMarketRepository {
  private snapshot: MarketSnapshot | null = null;
  private sales: GiftSale[] = [];
  private candles: Map<string, GiftCandle[]> = new Map();
  private outboxEvents: OutboxEvent[] = [];

  public saveSnapshot(snapshot: MarketSnapshot): void {
    this.snapshot = JSON.parse(JSON.stringify(snapshot));
  }

  public loadSnapshot(): MarketSnapshot | null {
    if (!this.snapshot) return null;
    return JSON.parse(JSON.stringify(this.snapshot));
  }

  public saveSale(sale: GiftSale): void {
    this.sales.push({ ...sale });
  }

  public getSales(): GiftSale[] {
    return [...this.sales];
  }

  public saveCandles(instrumentKey: string, timeframe: Timeframe, candles: GiftCandle[]): void {
    const key = `${instrumentKey}:${timeframe}`;
    this.candles.set(key, JSON.parse(JSON.stringify(candles)));
  }

  public getCandles(
    instrumentKey: string,
    timeframe: Timeframe,
    options?: { from?: number; to?: number; limit?: number }
  ): GiftCandle[] {
    const key = `${instrumentKey}:${timeframe}`;
    let list = this.candles.get(key) ? [...this.candles.get(key)!] : [];
    if (options) {
      if (typeof options.from === 'number') {
        list = list.filter((c) => c.startTime >= options.from!);
      }
      if (typeof options.to === 'number') {
        list = list.filter((c) => c.startTime < options.to!);
      }
      if (typeof options.limit === 'number' && options.limit > 0) {
        list = list.slice(-options.limit);
      }
    }
    return list;
  }

  public async saveSaleAndCandlesAtomic(
    sale: GiftSale,
    candles: GiftCandle[],
    outboxEvents?: OutboxEvent[]
  ): Promise<{ isNew: boolean }> {
    const exists = this.sales.some((s) => s.id === sale.id);
    if (exists) {
      return { isNew: false };
    }
    this.saveSale(sale);
    for (const c of candles) {
      const key = `${c.instrumentKey}:${c.timeframe}`;
      let existingList = this.candles.get(key) || [];
      const idx = existingList.findIndex((item) => item.startTime === c.startTime);
      if (idx !== -1) {
        if ((c.revision ?? 0) >= (existingList[idx].revision ?? 0)) {
          existingList[idx] = { ...c };
        }
      } else {
        existingList.push({ ...c });
      }
      this.candles.set(key, existingList);
    }
    if (outboxEvents && outboxEvents.length > 0) {
      for (const evt of outboxEvents) {
        await this.saveOutboxEvent(evt);
      }
    }
    return { isNew: true };
  }

  public async saveOutboxEvent(event: OutboxEvent): Promise<void> {
    const idx = this.outboxEvents.findIndex((e) => e.eventId === event.eventId);
    if (idx !== -1) {
      this.outboxEvents[idx] = JSON.parse(JSON.stringify(event));
    } else {
      this.outboxEvents.push(JSON.parse(JSON.stringify(event)));
    }
  }

  public async fetchPendingOutboxEvents(
    limit: number = 20,
    lockLeaseMs: number = 30000
  ): Promise<OutboxEvent[]> {
    const now = Date.now();
    const staleThreshold = now - lockLeaseMs;
    const pending = this.outboxEvents
      .filter(
        (e) =>
          (e.status === 'pending' && e.availableAt <= now) ||
          (e.status === 'processing' && (e.lockedAt === undefined || e.lockedAt < staleThreshold))
      )
      .slice(0, limit);

    for (const p of pending) {
      p.status = 'processing';
      p.lockedAt = now;
      p.attempts += 1;
      p.updatedAt = now;
    }
    return pending.map((p) => JSON.parse(JSON.stringify(p)));
  }

  public async markOutboxEventPublished(
    eventId: string,
    publishedAt: number = Date.now()
  ): Promise<void> {
    const item = this.outboxEvents.find((e) => e.eventId === eventId);
    if (item) {
      item.status = 'published';
      item.publishedAt = publishedAt;
      item.updatedAt = publishedAt;
    }
  }

  public async markOutboxEventFailed(
    eventId: string,
    errorMsg: string,
    nextAvailableAt?: number
  ): Promise<void> {
    const item = this.outboxEvents.find((e) => e.eventId === eventId);
    if (item) {
      item.lastError = errorMsg;
      item.availableAt = nextAvailableAt || Date.now() + 5000;
      item.lockedAt = undefined;
      item.updatedAt = Date.now();
      if (item.attempts >= 10) {
        item.status = 'failed';
      } else {
        item.status = 'pending';
      }
    }
  }

  public async getOutboxEventById(eventId: string): Promise<OutboxEvent | null> {
    const item = this.outboxEvents.find((e) => e.eventId === eventId);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  public clear(): void {
    this.snapshot = null;
    this.sales = [];
    this.candles.clear();
    this.outboxEvents = [];
  }
}

/**
 * File-backed Persistent Repository with atomic write-rename and corruption recovery backup.
 */
export class FilePersistentMarketRepository implements IMarketRepository {
  private filePath: string;
  private backupPath: string;
  private isWriting = false;
  private writeQueue: (() => void)[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), '.market_state_snapshot.json');
    this.backupPath = `${this.filePath}.bak`;
  }

  private async acquireWriteLock(): Promise<() => void> {
    if (!this.isWriting) {
      this.isWriting = true;
      return () => {
        this.isWriting = false;
        const next = this.writeQueue.shift();
        if (next) next();
      };
    }
    return new Promise((resolve) => {
      this.writeQueue.push(() => {
        this.isWriting = true;
        resolve(() => {
          this.isWriting = false;
          const next = this.writeQueue.shift();
          if (next) next();
        });
      });
    });
  }

  public async saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    const release = await this.acquireWriteLock();
    try {
      const data = JSON.stringify(snapshot, null, 2);
      const tmpPath = `${this.filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;

      // Create backup if previous valid file exists
      if (fs.existsSync(this.filePath)) {
        try {
          fs.copyFileSync(this.filePath, this.backupPath);
        } catch (err) {
          console.warn('FilePersistentMarketRepository: Failed to create backup file:', err);
        }
      }

      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('FilePersistentMarketRepository saveSnapshot error:', err);
    } finally {
      release();
    }
  }

  public loadSnapshot(): MarketSnapshot | null {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error(
        'FilePersistentMarketRepository primary file read/parse error, trying backup:',
        err
      );
    }

    try {
      if (fs.existsSync(this.backupPath)) {
        const backupData = fs.readFileSync(this.backupPath, 'utf-8');
        const restored = JSON.parse(backupData);
        console.log(
          'FilePersistentMarketRepository: Successfully recovered snapshot from backup file.'
        );
        return restored;
      }
    } catch (backupErr) {
      console.error('FilePersistentMarketRepository backup load failed:', backupErr);
    }

    return null;
  }

  public async saveSale(sale: GiftSale): Promise<void> {
    const snap = this.loadSnapshot() || {
      version: 1,
      timestamp: Date.now(),
      allSales: [],
      processedSaleIds: [],
      activeCandles: {},
      closedCandles: {},
    };
    snap.allSales.push(sale);
    if (!snap.processedSaleIds.includes(sale.id)) {
      snap.processedSaleIds.push(sale.id);
    }
    await this.saveSnapshot(snap);
  }

  public getSales(): GiftSale[] {
    const snap = this.loadSnapshot();
    return snap ? snap.allSales : [];
  }

  public async saveCandles(
    instrumentKey: string,
    timeframe: Timeframe,
    candles: GiftCandle[]
  ): Promise<void> {
    const snap = this.loadSnapshot() || {
      version: 1,
      timestamp: Date.now(),
      allSales: [],
      processedSaleIds: [],
      activeCandles: {},
      closedCandles: {},
    };
    if (!snap.closedCandles[instrumentKey]) {
      snap.closedCandles[instrumentKey] = {};
    }
    snap.closedCandles[instrumentKey][timeframe] = candles;
    await this.saveSnapshot(snap);
  }

  public getCandles(
    instrumentKey: string,
    timeframe: Timeframe,
    options?: { from?: number; to?: number; limit?: number }
  ): GiftCandle[] {
    const snap = this.loadSnapshot();
    let list = snap?.closedCandles?.[instrumentKey]?.[timeframe] || [];
    if (options) {
      if (typeof options.from === 'number') {
        list = list.filter((c) => c.startTime >= options.from!);
      }
      if (typeof options.to === 'number') {
        list = list.filter((c) => c.startTime < options.to!);
      }
      if (typeof options.limit === 'number' && options.limit > 0) {
        list = list.slice(-options.limit);
      }
    }
    return list;
  }

  public clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
      if (fs.existsSync(this.backupPath)) fs.unlinkSync(this.backupPath);
    } catch (err) {
      console.error('FilePersistentMarketRepository clear error:', err);
    }
  }
}

/**
 * Enterprise Production PostgreSQL Repository for atomic multi-instance persistence.
 */
export function getPgPool(): Pool {
  if (global._postgresPool) {
    return global._postgresPool;
  }
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL || process.env.SQL_HOST);

  if (process.env.SQL_HOST) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 20,
    });

    // Prevent unhandled pool-level errors from crashing the application
    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });

    return global._postgresPool;
  }

  throw new Error('No SQL_HOST configured');
}

export class PostgresMarketRepository implements IMarketRepository {
  private pool: Pool;
  private initialized = false;

  constructor(connectionStringOrConfig?: string | PoolConfig) {
    if (typeof connectionStringOrConfig === 'string') {
      this.pool = new Pool({ connectionString: connectionStringOrConfig });
    } else if (connectionStringOrConfig) {
      this.pool = new Pool(connectionStringOrConfig);
    } else {
      this.pool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
      });
    }

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });

    this.pool.on('connect', (client) => {
      client
        .query('SELECT current_user')
        .then((userRes) => {
          const user = userRes?.rows?.[0]?.current_user;
          if (user) {
            client.query(`SET search_path TO "${user}", public`).catch(() => {});
          }
        })
        .catch(() => {});
    });
  }

  public async initSchema(): Promise<void> {
    if (this.initialized) return;

    // Safety check: do not run DDL in production during regular runtime unless RUN_MIGRATIONS is set
    if (process.env.NODE_ENV === 'production' && process.env.RUN_MIGRATIONS !== 'true') {
      console.log(
        'PostgresMarketRepository: Skipping initSchema in production. Migrations must be run explicitly.'
      );
      this.initialized = true;
      return;
    }

    const client = await this.pool.connect();
    try {
      try {
        const userRes = await client.query('SELECT current_user');
        const user = userRes?.rows?.[0]?.current_user;

        if (user) {
          try {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${user}" AUTHORIZATION "${user}"`);
          } catch (schemaErr: any) {}

          await client.query(`SET search_path TO "${user}", public`);
        }
      } catch (err: any) {}

      try {
        await client.query('BEGIN');

        await client.query(`
          CREATE TABLE IF NOT EXISTS completed_sales (
            sale_id TEXT PRIMARY KEY,
            dedupe_key TEXT UNIQUE NOT NULL,
            collection_id TEXT NOT NULL,
            gift_id TEXT,
            model_id TEXT,
            backdrop_id TEXT,
            currency TEXT NOT NULL,
            instrument_key TEXT NOT NULL,
            price NUMERIC NOT NULL,
            quantity NUMERIC NOT NULL,
            event_time BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            status TEXT NOT NULL,
            transaction_hash TEXT,
            source TEXT NOT NULL DEFAULT 'real',
            simulation BOOLEAN NOT NULL DEFAULT false,
            inserted_at BIGINT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS candles (
            instrument_key TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            start_time BIGINT NOT NULL,
            end_time BIGINT NOT NULL,
            open NUMERIC NOT NULL,
            high NUMERIC NOT NULL,
            low NUMERIC NOT NULL,
            close NUMERIC NOT NULL,
            volume NUMERIC NOT NULL,
            quote_volume NUMERIC NOT NULL,
            sum_quote NUMERIC NOT NULL,
            sum_quantity NUMERIC NOT NULL,
            item_count NUMERIC NOT NULL,
            trade_count INTEGER NOT NULL,
            first_sale_id TEXT NOT NULL,
            last_sale_id TEXT NOT NULL,
            confirmed BOOLEAN NOT NULL,
            revision INTEGER NOT NULL,
            updated_at BIGINT NOT NULL,
            PRIMARY KEY (instrument_key, timeframe, start_time)
          );

          CREATE TABLE IF NOT EXISTS market_snapshots (
            id SERIAL PRIMARY KEY,
            version INTEGER NOT NULL,
            timestamp BIGINT NOT NULL,
            snapshot JSONB NOT NULL,
            is_simulation BOOLEAN NOT NULL DEFAULT false
          );

          CREATE TABLE IF NOT EXISTS outbox_events (
            id SERIAL PRIMARY KEY,
            event_id TEXT UNIQUE NOT NULL,
            event_type TEXT NOT NULL,
            aggregate_type TEXT NOT NULL,
            aggregate_id TEXT NOT NULL,
            instrument_key TEXT NOT NULL,
            timeframe TEXT,
            payload JSONB NOT NULL,
            sequence BIGINT,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            available_at BIGINT NOT NULL,
            locked_at BIGINT,
            published_at BIGINT,
            last_error TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON outbox_events (status, available_at) WHERE status IN ('pending', 'processing');
        `);
        await client.query('COMMIT');
      } catch (ddlErr: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.warn('PostgresMarketRepository initSchema DDL notice:', ddlErr?.message);
      }
      this.initialized = true;
    } catch (err: any) {
      console.warn('PostgresMarketRepository initSchema connection notice:', err?.message || err);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  public async saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    await this.initSchema();
    await this.pool.query(
      `INSERT INTO market_snapshots (version, timestamp, snapshot, is_simulation) VALUES ($1, $2, $3, $4)`,
      [
        snapshot.version,
        snapshot.timestamp,
        JSON.stringify(snapshot),
        Boolean(snapshot.isSimulation),
      ]
    );
  }

  public async loadSnapshot(): Promise<MarketSnapshot | null> {
    await this.initSchema();
    const res = await this.pool.query(
      `SELECT snapshot FROM market_snapshots ORDER BY id DESC LIMIT 1`
    );
    if (res.rows.length === 0) return null;
    return res.rows[0].snapshot;
  }

  public async saveSale(sale: GiftSale): Promise<void> {
    await this.initSchema();
    await this.pool.query(
      `INSERT INTO completed_sales (
        sale_id, dedupe_key, collection_id, gift_id, model_id, backdrop_id, currency,
        instrument_key, price, quantity, event_time, created_at, status, transaction_hash,
        source, simulation, inserted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        sale.id,
        sale.id,
        sale.collectionId,
        sale.giftId || null,
        sale.modelId || null,
        sale.backdropId || null,
        sale.currency,
        sale.instrumentKey || `${sale.collectionId}:all:all:${sale.currency}`,
        sale.price,
        sale.quantity,
        sale.eventTime,
        sale.createdAt || sale.eventTime,
        sale.status || 'completed',
        sale.transactionHash || null,
        sale.isMock ? 'simulation' : 'real',
        Boolean(sale.isMock),
        Date.now(),
      ]
    );
  }

  public async saveSaleAndCandlesAtomic(
    sale: GiftSale,
    candles: GiftCandle[],
    outboxEvents?: OutboxEvent[]
  ): Promise<{ isNew: boolean }> {
    await this.initSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const saleRes = await client.query(
        `INSERT INTO completed_sales (
          sale_id, dedupe_key, collection_id, gift_id, model_id, backdrop_id, currency,
          instrument_key, price, quantity, event_time, created_at, status, transaction_hash,
          source, simulation, inserted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          sale.id,
          sale.id,
          sale.collectionId,
          sale.giftId || null,
          sale.modelId || null,
          sale.backdropId || null,
          sale.currency,
          sale.instrumentKey || `${sale.collectionId}:all:all:${sale.currency}`,
          sale.price,
          sale.quantity,
          sale.eventTime,
          sale.createdAt || sale.eventTime,
          sale.status || 'completed',
          sale.transactionHash || null,
          sale.isMock ? 'simulation' : 'real',
          Boolean(sale.isMock),
          Date.now(),
        ]
      );

      if (saleRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { isNew: false };
      }

      for (const c of candles) {
        await client.query(
          `INSERT INTO candles (
            instrument_key, timeframe, start_time, end_time, open, high, low, close,
            volume, quote_volume, sum_quote, sum_quantity, item_count, trade_count,
            first_sale_id, last_sale_id, confirmed, revision, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (instrument_key, timeframe, start_time) DO UPDATE SET
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            open = EXCLUDED.open,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            quote_volume = EXCLUDED.quote_volume,
            sum_quote = EXCLUDED.sum_quote,
            sum_quantity = EXCLUDED.sum_quantity,
            item_count = EXCLUDED.item_count,
            trade_count = EXCLUDED.trade_count,
            first_sale_id = EXCLUDED.first_sale_id,
            last_sale_id = EXCLUDED.last_sale_id,
            confirmed = EXCLUDED.confirmed,
            revision = EXCLUDED.revision,
            updated_at = EXCLUDED.updated_at`,
          [
            c.instrumentKey,
            c.timeframe,
            c.startTime,
            c.endTime,
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume,
            c.quoteVolume,
            c.sumQuote || c.quoteVolume,
            c.sumQuantity || c.volume,
            c.itemCount || c.volume,
            c.tradeCount,
            c.firstSaleId,
            c.lastSaleId,
            c.confirmed,
            c.revision,
            c.updatedAt,
          ]
        );
      }

      if (outboxEvents && outboxEvents.length > 0) {
        for (const evt of outboxEvents) {
          await client.query(
            `INSERT INTO outbox_events (
              event_id, event_type, aggregate_type, aggregate_id, instrument_key, timeframe,
              payload, sequence, status, attempts, available_at, locked_at, published_at,
              last_error, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (event_id) DO NOTHING`,
            [
              evt.eventId,
              evt.eventType,
              evt.aggregateType,
              evt.aggregateId,
              evt.instrumentKey,
              evt.timeframe || null,
              JSON.stringify(evt.payload),
              evt.sequence || null,
              evt.status || 'pending',
              evt.attempts || 0,
              evt.availableAt || Date.now(),
              evt.lockedAt || null,
              evt.publishedAt || null,
              evt.lastError || null,
              evt.createdAt || Date.now(),
              evt.updatedAt || Date.now(),
            ]
          );
        }
      }

      await client.query('COMMIT');
      return { isNew: true };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PostgresMarketRepository saveSaleAndCandlesAtomic error:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async saveOutboxEvent(event: OutboxEvent): Promise<void> {
    await this.initSchema();
    await this.pool.query(
      `INSERT INTO outbox_events (
        event_id, event_type, aggregate_type, aggregate_id, instrument_key, timeframe,
        payload, sequence, status, attempts, available_at, locked_at, published_at,
        last_error, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        event.instrumentKey,
        event.timeframe || null,
        JSON.stringify(event.payload),
        event.sequence || null,
        event.status || 'pending',
        event.attempts || 0,
        event.availableAt || Date.now(),
        event.lockedAt || null,
        event.publishedAt || null,
        event.lastError || null,
        event.createdAt || Date.now(),
        event.updatedAt || Date.now(),
      ]
    );
  }

  public async fetchPendingOutboxEvents(
    limit: number = 20,
    lockLeaseMs: number = 30000
  ): Promise<OutboxEvent[]> {
    await this.initSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = Date.now();
      const staleThreshold = now - lockLeaseMs;

      const selectRes = await client.query(
        `SELECT id, event_id as "eventId", event_type as "eventType", aggregate_type as "aggregateType",
                aggregate_id as "aggregateId", instrument_key as "instrumentKey", timeframe, payload,
                sequence, status, attempts, available_at as "availableAt", locked_at as "lockedAt",
                published_at as "publishedAt", last_error as "lastError", created_at as "createdAt",
                updated_at as "updatedAt"
         FROM outbox_events
         WHERE (status = 'pending' AND available_at <= $1)
            OR (status = 'processing' AND (locked_at IS NULL OR locked_at < $2))
         ORDER BY id ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [now, staleThreshold, limit]
      );

      if (selectRes.rows.length === 0) {
        await client.query('COMMIT');
        return [];
      }

      const eventIds = selectRes.rows.map((r) => r.eventId);
      await client.query(
        `UPDATE outbox_events
         SET status = 'processing',
             locked_at = $1,
             attempts = attempts + 1,
             updated_at = $1
         WHERE event_id = ANY($2::text[])`,
        [now, eventIds]
      );

      await client.query('COMMIT');

      return selectRes.rows.map((r) => ({
        ...r,
        id: Number(r.id),
        attempts: Number(r.attempts) + 1,
        availableAt: Number(r.availableAt),
        lockedAt: now,
        publishedAt: r.publishedAt ? Number(r.publishedAt) : undefined,
        createdAt: Number(r.createdAt),
        updatedAt: now,
        sequence: r.sequence ? Number(r.sequence) : undefined,
      }));
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PostgresMarketRepository fetchPendingOutboxEvents error:', err);
      return [];
    } finally {
      client.release();
    }
  }

  public async markOutboxEventPublished(
    eventId: string,
    publishedAt: number = Date.now()
  ): Promise<void> {
    await this.initSchema();
    await this.pool.query(
      `UPDATE outbox_events
       SET status = 'published',
           published_at = $1,
           updated_at = $1
       WHERE event_id = $2`,
      [publishedAt, eventId]
    );
  }

  public async markOutboxEventFailed(
    eventId: string,
    errorMsg: string,
    nextAvailableAt?: number
  ): Promise<void> {
    await this.initSchema();
    const now = Date.now();
    const availAt = nextAvailableAt || now + 5000;
    await this.pool.query(
      `UPDATE outbox_events
       SET status = CASE WHEN attempts >= 10 THEN 'failed' ELSE 'pending' END,
           last_error = $1,
           available_at = $2,
           locked_at = NULL,
           updated_at = $3
       WHERE event_id = $4`,
      [errorMsg, availAt, now, eventId]
    );
  }

  public async getOutboxEventById(eventId: string): Promise<OutboxEvent | null> {
    await this.initSchema();
    const res = await this.pool.query(
      `SELECT id, event_id as "eventId", event_type as "eventType", aggregate_type as "aggregateType",
              aggregate_id as "aggregateId", instrument_key as "instrumentKey", timeframe, payload,
              sequence, status, attempts, available_at as "availableAt", locked_at as "lockedAt",
              published_at as "publishedAt", last_error as "lastError", created_at as "createdAt",
              updated_at as "updatedAt"
       FROM outbox_events WHERE event_id = $1`,
      [eventId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      ...r,
      id: Number(r.id),
      attempts: Number(r.attempts),
      availableAt: Number(r.availableAt),
      lockedAt: r.lockedAt ? Number(r.lockedAt) : undefined,
      publishedAt: r.publishedAt ? Number(r.publishedAt) : undefined,
      createdAt: Number(r.createdAt),
      updatedAt: Number(r.updatedAt),
      sequence: r.sequence ? Number(r.sequence) : undefined,
    };
  }

  public async getSales(): Promise<GiftSale[]> {
    await this.initSchema();
    const res = await this.pool.query(
      `SELECT sale_id as id, collection_id as "collectionId", gift_id as "giftId",
              model_id as "modelId", backdrop_id as "backdropId", currency, price::text,
              quantity::text, event_time as "eventTime", created_at as "createdAt", status,
              transaction_hash as "transactionHash", simulation as "isMock"
       FROM completed_sales ORDER BY event_time ASC`
    );
    return res.rows.map((r) => ({
      ...r,
      eventTime: Number(r.eventTime),
      createdAt: Number(r.createdAt),
    }));
  }

  public async saveCandles(
    instrumentKey: string,
    timeframe: Timeframe,
    candles: GiftCandle[]
  ): Promise<void> {
    await this.initSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of candles) {
        await client.query(
          `INSERT INTO candles (
            instrument_key, timeframe, start_time, end_time, open, high, low, close,
            volume, quote_volume, sum_quote, sum_quantity, item_count, trade_count,
            first_sale_id, last_sale_id, confirmed, revision, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (instrument_key, timeframe, start_time) DO UPDATE SET
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            open = EXCLUDED.open,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            quote_volume = EXCLUDED.quote_volume,
            sum_quote = EXCLUDED.sum_quote,
            sum_quantity = EXCLUDED.sum_quantity,
            item_count = EXCLUDED.item_count,
            trade_count = EXCLUDED.trade_count,
            first_sale_id = EXCLUDED.first_sale_id,
            last_sale_id = EXCLUDED.last_sale_id,
            confirmed = EXCLUDED.confirmed,
            revision = EXCLUDED.revision,
            updated_at = EXCLUDED.updated_at`,
          [
            instrumentKey,
            timeframe,
            c.startTime,
            c.endTime,
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume,
            c.quoteVolume,
            c.sumQuote || c.quoteVolume,
            c.sumQuantity || c.volume,
            c.itemCount || c.volume,
            c.tradeCount,
            c.firstSaleId,
            c.lastSaleId,
            c.confirmed,
            c.revision,
            c.updatedAt,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PostgresMarketRepository saveCandles error:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async getCandles(
    instrumentKey: string,
    timeframe: Timeframe,
    options?: { from?: number; to?: number; limit?: number }
  ): Promise<GiftCandle[]> {
    await this.initSchema();
    let query = `SELECT instrument_key as "instrumentKey", timeframe, start_time as "startTime",
                        end_time as "endTime", open::text, high::text, low::text, close::text,
                        volume::text, quote_volume as "quoteVolume", sum_quote as "sumQuote",
                        sum_quantity as "sumQuantity", item_count as "itemCount", trade_count as "tradeCount",
                        first_sale_id as "firstSaleId", last_sale_id as "lastSaleId", confirmed, revision, updated_at as "updatedAt"
                 FROM candles WHERE instrument_key = $1 AND timeframe = $2`;
    const params: any[] = [instrumentKey, timeframe];

    if (options?.from !== undefined) {
      params.push(options.from);
      query += ` AND start_time >= $${params.length}`;
    }
    if (options?.to !== undefined) {
      params.push(options.to);
      query += ` AND start_time < $${params.length}`;
    }

    query += ` ORDER BY start_time ASC`;

    if (options?.limit && options.limit > 0) {
      params.push(options.limit);
      query += ` LIMIT $${params.length}`;
    }

    const res = await this.pool.query(query, params);
    return res.rows.map((r) => ({
      ...r,
      startTime: Number(r.startTime),
      endTime: Number(r.endTime),
      tradeCount: Number(r.tradeCount),
      revision: Number(r.revision),
      updatedAt: Number(r.updatedAt),
    }));
  }

  public async clear(): Promise<void> {
    await this.initSchema();
    await this.pool.query(`TRUNCATE completed_sales, candles, market_snapshots`);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Validates production environment safety rules for storage configuration.
 */
export function resolveMarketRepository(): IMarketRepository {
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL || process.env.SQL_HOST);
  const storageMode = process.env.STORAGE_MODE;
  const allowFileInProd = process.env.ALLOW_FILE_STORAGE_IN_PRODUCTION === 'true';

  if (isProduction) {
    if (allowFileInProd) {
      console.warn(
        'CRITICAL WARNING: ALLOW_FILE_STORAGE_IN_PRODUCTION=true is set but IGNORED in production mode. File storage is strictly forbidden in production.'
      );
    }
    if (!hasDatabaseUrl) {
      const errMsg =
        'CRITICAL CONFIGURATION ERROR: Production mode requires DATABASE_URL for Postgres persistence. File storage is STRICTLY BANNED in production environment.';
      console.error(errMsg);
      throw new Error(errMsg);
    }
    console.log('Production Persistence: Initializing PostgresMarketRepository with DATABASE_URL.');
    return new PostgresMarketRepository();
  }

  if (hasDatabaseUrl && storageMode !== 'file') {
    return new PostgresMarketRepository();
  }

  if (storageMode === 'file') {
    return new FilePersistentMarketRepository();
  }

  if (process.env.NODE_ENV === 'test') {
    return new InMemoryMarketRepository();
  }

  return new FilePersistentMarketRepository();
}
