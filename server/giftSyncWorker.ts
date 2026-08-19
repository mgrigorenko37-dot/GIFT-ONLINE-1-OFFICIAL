import { PoolClient } from 'pg';
import { getPgPool } from './marketRepository';
import { MOCK_GIFTS_FIXTURE, MOCK_VARIANTS_FIXTURE } from './mocks/giftsFixture';

export interface TonCollectionItem {
  address: string;
  name: string;
  next_item_index?: number;
  image?: string;
  previews?: Array<{ url?: string }>;
}

export interface TonNftItem {
  address: string;
  metadata?: {
    image?: string;
    attributes?: Array<{
      trait_type: string;
      value: string;
    }>;
  };
}

export interface SyncOptions {
  forceMock?: boolean;
  tonApiEndpoint?: string;
  tonApiKey?: string;
}

export interface SyncResult {
  success: boolean;
  source: 'ton_api' | 'mock' | 'empty';
  collectionsSynced: number;
  variantsSynced: number;
  error?: string;
}

export const SYNC_ADVISORY_LOCK_ID = 8182991;

/**
 * Validates TON API collections response against expected structure.
 */
export function validateTonCollectionsResponse(data: any): TonCollectionItem[] | null {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.nft_collections)) return null;

  const validCollections: TonCollectionItem[] = [];
  for (const item of data.nft_collections) {
    if (item && typeof item === 'object' && typeof item.address === 'string' && typeof item.name === 'string') {
      validCollections.push(item);
    }
  }
  return validCollections;
}

/**
 * Validates TON API items response against expected structure.
 */
export function validateTonItemsResponse(data: any): TonNftItem[] | null {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.nft_items)) return null;

  const validItems: TonNftItem[] = [];
  for (const item of data.nft_items) {
    if (item && typeof item === 'object' && typeof item.address === 'string') {
      validItems.push(item);
    }
  }
  return validItems;
}

/**
 * Main Telegram Gifts Synchronizer with strict separation of Production and Mock modes.
 */
export async function syncTelegramGifts(options?: SyncOptions): Promise<SyncResult> {
  let client: PoolClient | null = null;
  let lockAcquired = false;

  const isProduction = process.env.NODE_ENV === 'production';
  const useMockGifts = options?.forceMock ?? (process.env.USE_MOCK_GIFTS === 'true');

  try {
    client = await getPgPool().connect();

    // 1. Acquire PostgreSQL distributed advisory lock
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) as locked', [SYNC_ADVISORY_LOCK_ID]);
    if (!lockRes.rows[0]?.locked) {
      console.log('[GiftSync] Another sync process holds the advisory lock. Skipping cycle.');
      return {
        success: true,
        source: 'empty',
        collectionsSynced: 0,
        variantsSynced: 0,
        error: 'Lock held by another instance',
      };
    }
    lockAcquired = true;

    // 2. Production Mode Execution (Strict: only TON API & PostgreSQL)
    if (!useMockGifts) {
      if (isProduction && process.env.USE_MOCK_GIFTS === 'true') {
        console.warn('[GiftSync] SAFETY REJECTION: Mock fixtures are strictly prohibited in production mode.');
      }

      console.log('[GiftSync] Running in PRODUCTION mode (Strict TON API source).');
      const tonEndpoint = options?.tonApiEndpoint || process.env.TON_API_ENDPOINT || 'https://tonapi.io/v2';
      const apiKey = options?.tonApiKey || process.env.TON_API_KEY;

      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const url = `${tonEndpoint.replace(/\/$/, '')}/nfts/collections?limit=100`;
      let res: Response;
      try {
        res = await fetch(url, { headers });
      } catch (networkErr: any) {
        console.error('[GiftSync] Network failure reaching TON API:', networkErr?.message);
        return {
          success: false,
          source: 'ton_api',
          collectionsSynced: 0,
          variantsSynced: 0,
          error: `TON API network error: ${networkErr?.message}`,
        };
      }

      if (!res.ok) {
        const statusText = res.statusText || `HTTP ${res.status}`;
        console.error(`[GiftSync] TON API responded with error status: ${res.status} ${statusText}`);
        return {
          success: false,
          source: 'ton_api',
          collectionsSynced: 0,
          variantsSynced: 0,
          error: `TON API error (${res.status} ${statusText})`,
        };
      }

      let data: any;
      try {
        data = await res.json();
      } catch (jsonErr: any) {
        console.error('[GiftSync] Failed to parse TON API JSON response:', jsonErr?.message);
        return {
          success: false,
          source: 'ton_api',
          collectionsSynced: 0,
          variantsSynced: 0,
          error: 'Malformed JSON from TON API',
        };
      }

      const validatedCollections = validateTonCollectionsResponse(data);
      if (!validatedCollections) {
        console.error('[GiftSync] Invalid response structure from TON API collections endpoint.');
        return {
          success: false,
          source: 'ton_api',
          collectionsSynced: 0,
          variantsSynced: 0,
          error: 'Invalid TON API collections structure',
        };
      }

      const tgCollections = validatedCollections.filter(
        (c) => c.name && c.name.toLowerCase().includes('gift')
      );

      let collectionsSynced = 0;
      let variantsSynced = 0;

      await client.query('BEGIN');

      try {
        for (const c of tgCollections) {
          const totalSupply = Number(c.next_item_index) || 0;
          const imageUrl = c.previews?.[0]?.url || c.image || '';
          const floorPrice = 0;

          // Idempotent UPSERT with unique constraint protection
          await client.query(
            `INSERT INTO gift_collections (id, name, total_supply, image_url, floor_price_gx, created_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name,
                 total_supply = EXCLUDED.total_supply,
                 image_url = CASE WHEN EXCLUDED.image_url <> '' THEN EXCLUDED.image_url ELSE gift_collections.image_url END,
                 floor_price_gx = EXCLUDED.floor_price_gx`,
            [c.address, c.name, totalSupply, imageUrl, floorPrice]
          );
          collectionsSynced++;

          // Fetch items/variants
          try {
            const itemsUrl = `${tonEndpoint.replace(/\/$/, '')}/nfts/collections/${encodeURIComponent(c.address)}/items?limit=20`;
            const itemsRes = await fetch(itemsUrl, { headers });
            if (itemsRes.ok) {
              const itemsData = await itemsRes.json();
              const validItems = validateTonItemsResponse(itemsData);
              if (validItems) {
                for (const item of validItems) {
                  const attributes = item.metadata?.attributes || [];
                  const model = attributes.find((a: any) => a.trait_type === 'Model')?.value || 'Standard';
                  const backdrop = attributes.find((a: any) => a.trait_type === 'Backdrop')?.value || '#2a2840';
                  const symbol = attributes.find((a: any) => a.trait_type === 'Symbol')?.value || 'None';
                  const itemImage = item.metadata?.image || '';

                  await client.query(
                    `INSERT INTO gift_variants (id, collection_id, model_name, symbol_name, backdrop_color, rarity_percentage, current_price_gx, image_url, last_synced_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
                     ON CONFLICT (id) DO UPDATE
                     SET model_name = EXCLUDED.model_name,
                         symbol_name = EXCLUDED.symbol_name,
                         backdrop_color = EXCLUDED.backdrop_color,
                         rarity_percentage = EXCLUDED.rarity_percentage,
                         current_price_gx = EXCLUDED.current_price_gx,
                         image_url = CASE WHEN EXCLUDED.image_url <> '' THEN EXCLUDED.image_url ELSE gift_variants.image_url END,
                         last_synced_at = now()`,
                    [item.address, c.address, model, symbol, backdrop, 5.0, 120, itemImage]
                  );
                  variantsSynced++;
                }
              }
            }
          } catch (itemErr) {
            console.warn(`[GiftSync] Could not fetch items for collection ${c.address}:`, itemErr);
          }
        }

        await client.query('COMMIT');
        console.log(`[GiftSync] Production sync completed. Collections: ${collectionsSynced}, Variants: ${variantsSynced}`);
        return {
          success: true,
          source: 'ton_api',
          collectionsSynced,
          variantsSynced,
        };
      } catch (txErr: any) {
        await client.query('ROLLBACK');
        console.error('[GiftSync] Transaction error during production sync:', txErr?.message);
        return {
          success: false,
          source: 'ton_api',
          collectionsSynced: 0,
          variantsSynced: 0,
          error: txErr?.message,
        };
      }
    }

    // 3. Development Mode Execution (USE_MOCK_GIFTS=true)
    console.log('[GiftSync] Running in DEVELOPMENT mode (USE_MOCK_GIFTS=true, Deterministic Mock Fixtures).');
    await client.query('BEGIN');

    let mockCollectionsSynced = 0;
    let mockVariantsSynced = 0;

    try {
      for (const g of MOCK_GIFTS_FIXTURE) {
        await client.query(
          `INSERT INTO gift_collections (id, name, total_supply, image_url, floor_price_gx, created_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               total_supply = EXCLUDED.total_supply,
               floor_price_gx = EXCLUDED.floor_price_gx`,
          [g.id, g.name, g.total_supply || 10000, g.image_url || '', g.floor]
        );
        mockCollectionsSynced++;
      }

      for (const v of MOCK_VARIANTS_FIXTURE) {
        await client.query(
          `INSERT INTO gift_variants (id, collection_id, model_name, symbol_name, backdrop_color, rarity_percentage, current_price_gx, image_url, last_synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (id) DO UPDATE
           SET model_name = EXCLUDED.model_name,
               symbol_name = EXCLUDED.symbol_name,
               backdrop_color = EXCLUDED.backdrop_color,
               rarity_percentage = EXCLUDED.rarity_percentage,
               current_price_gx = EXCLUDED.current_price_gx,
               last_synced_at = now()`,
          [
            v.id,
            v.collection_id,
            v.model_name,
            v.symbol_name,
            v.backdrop_color,
            v.rarity_percentage,
            v.current_price_gx,
            v.image_url,
          ]
        );
        mockVariantsSynced++;
      }

      await client.query('COMMIT');
      console.log(`[GiftSync] Mock sync completed. Collections: ${mockCollectionsSynced}, Variants: ${mockVariantsSynced}`);
      return {
        success: true,
        source: 'mock',
        collectionsSynced: mockCollectionsSynced,
        variantsSynced: mockVariantsSynced,
      };
    } catch (txErr: any) {
      await client.query('ROLLBACK');
      console.error('[GiftSync] Transaction error during mock sync:', txErr?.message);
      return {
        success: false,
        source: 'mock',
        collectionsSynced: 0,
        variantsSynced: 0,
        error: txErr?.message,
      };
    }
  } catch (err: any) {
    console.error('[GiftSync] Sync worker fatal error:', err);
    return {
      success: false,
      source: useMockGifts ? 'mock' : 'ton_api',
      collectionsSynced: 0,
      variantsSynced: 0,
      error: err?.message || 'Unknown sync failure',
    };
  } finally {
    if (client) {
      if (lockAcquired) {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [SYNC_ADVISORY_LOCK_ID]);
        } catch (unlockErr) {
          console.warn('[GiftSync] Advisory unlock error:', unlockErr);
        }
      }
      client.release();
    }
  }
}

let syncIntervalTimer: NodeJS.Timeout | null = null;

export function startGiftSyncWorker() {
  if (syncIntervalTimer) return;
  syncIntervalTimer = setInterval(() => {
    syncTelegramGifts().catch((err) => {
      console.error('[GiftSync] Periodic sync error:', err);
    });
  }, 300000); // 5 minutes

  setTimeout(() => {
    syncTelegramGifts().catch((err) => {
      console.error('[GiftSync] Initial sync error:', err);
    });
  }, 2000);
}
