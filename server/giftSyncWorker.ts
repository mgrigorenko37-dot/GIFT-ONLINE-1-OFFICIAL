import { getPgPool } from './marketRepository';
import { gifts as hardcodedGifts } from '../src/data/gifts';

export const syncTelegramGifts = async () => {
  let client;
  try {
    client = await getPgPool().connect();

    // Advisory lock to prevent multiple instances from syncing simultaneously
    const lockRes = await client.query('SELECT pg_try_advisory_lock(8182991) as locked');
    if (!lockRes.rows[0].locked) {
      return;
    }

    const res = await fetch('https://tonapi.io/v2/nfts/collections?limit=100');
    const data = await res.json();
    const tonCollections = data.nft_collections || [];

    const tgCollections = tonCollections.filter(
      (c: any) => c.name && c.name.toLowerCase().includes('gift')
    );

    for (const c of tgCollections) {
      const totalSupply = c.next_item_index || 0;
      const imageUrl = c.previews?.[0]?.url || c.image || '';
      const floorPrice = 0;
      await client.query(
        `INSERT INTO gift_collections (id, name, total_supply, image_url, floor_price_gx, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE
         SET name = $2, total_supply = $3, image_url = $4, floor_price_gx = $5`,
        [c.address, c.name, totalSupply, imageUrl, floorPrice]
      );

      try {
        const itemsRes = await fetch(
          `https://tonapi.io/v2/nfts/collections/${c.address}/items?limit=10`
        );
        const itemsData = await itemsRes.json();
        const items = itemsData.nft_items || [];

        for (const item of items) {
          const attributes = item.metadata?.attributes || [];
          const model = attributes.find((a: any) => a.trait_type === 'Model')?.value || 'Standard';
          const backdrop = attributes.find((a: any) => a.trait_type === 'Backdrop')?.value || '#2a2840';
          const symbol = attributes.find((a: any) => a.trait_type === 'Symbol')?.value || 'None';
          const itemImage = item.metadata?.image || '';

          await client.query(
            `INSERT INTO gift_variants (id, collection_id, model_name, symbol_name, backdrop_color, rarity_percentage, current_price_gx, image_url, last_synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
             ON CONFLICT (id) DO UPDATE
             SET model_name = $3, symbol_name = $4, backdrop_color = $5, rarity_percentage = $6,
                 current_price_gx = $7, image_url = $8, last_synced_at = now()`,
            [item.address, c.address, model, symbol, backdrop, 5.0, 120, itemImage]
          );
        }
      } catch (err) {
        console.error('Failed to fetch items for collection', c.address);
      }
    }

    const useMocks = process.env.USE_MOCK_GIFTS !== 'false';
    if (useMocks || tgCollections.length === 0) {
      for (const g of hardcodedGifts) {
        await client.query(
          `INSERT INTO gift_collections (id, name, total_supply, image_url, floor_price_gx, created_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO UPDATE
           SET name = $2, total_supply = $3, floor_price_gx = $5`,
          [g.id, g.name, 10000, '', g.floor]
        );

        const backdrops = ['#ff0000', '#00ff00', '#0000ff', '#f0f0f0', '#2a2a2a'];
        const models = ['Standard', 'Holographic', 'Gold', 'Diamond'];

        for (let i = 0; i < 5; i++) {
          const variantId = `${g.id}-var-${i}`;
          const currentPrice = parseFloat((g.floor * (1 + Math.random() * 0.5)).toFixed(2));
          await client.query(
            `INSERT INTO gift_variants (id, collection_id, model_name, symbol_name, backdrop_color, rarity_percentage, current_price_gx, image_url, last_synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
             ON CONFLICT (id) DO UPDATE
             SET model_name = $3, symbol_name = $4, backdrop_color = $5, rarity_percentage = $6,
                 current_price_gx = $7, last_synced_at = now()`,
            [
              variantId,
              g.id,
              models[Math.floor(Math.random() * models.length)],
              'Original',
              backdrops[Math.floor(Math.random() * backdrops.length)],
              parseFloat((Math.random() * 100).toFixed(1)),
              currentPrice,
              '',
            ]
          );
        }
      }
    }

    console.log(`[GiftSync] Synced collections and variants to PostgreSQL.`);
  } catch (error) {
    console.error('[GiftSync] Sync failed:', error);
  } finally {
    if (client) {
      try {
        await client.query('SELECT pg_advisory_unlock(8182991)');
      } catch (e) {}
      client.release();
    }
  }
};

export function startGiftSyncWorker() {
  setInterval(syncTelegramGifts, 300000);
  setTimeout(syncTelegramGifts, 1000);
}
