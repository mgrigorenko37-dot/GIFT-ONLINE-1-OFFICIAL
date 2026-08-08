const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const interfaces = `
export interface GiftCollection {
  id: string;
  name: string;
  total_supply: number;
  image_url: string;
  floor_price_gx: number;
}

export interface GiftVariant {
  id: string;
  collection_id: string;
  model_name: string;
  backdrop_color: string;
  symbol_name: string;
  rarity_percentage: number;
  image_url: string;
  current_price_gx: number;
}

const dbCollections: GiftCollection[] = [];
const dbVariants: GiftVariant[] = [];

// Cron Job for syncing Telegram Gifts
const syncTelegramGifts = async () => {
  console.log("Starting Telegram Gifts Sync via TonAPI...");
  try {
    // 1. Fetch collections from TonAPI
    const res = await fetch("https://tonapi.io/v2/nfts/collections?limit=100");
    const data = await res.json();
    const tonCollections = data.nft_collections || [];
    
    // Process TonAPI collections (filter by telegram gifts if possible)
    const tgCollections = tonCollections.filter((c: any) => c.name && c.name.toLowerCase().includes('gift'));
    
    for (const c of tgCollections) {
      if (!dbCollections.find(dbC => dbC.id === c.address)) {
        dbCollections.push({
          id: c.address,
          name: c.name,
          total_supply: c.next_item_index || 10000,
          image_url: c.metadata?.image || '',
          floor_price_gx: 100
        });
      }
      
      // Attempt to fetch items for this collection to parse traits
      try {
        const itemsRes = await fetch(\`https://tonapi.io/v2/nfts/collections/\${c.address}/items?limit=10\`);
        const itemsData = await itemsRes.json();
        const items = itemsData.nft_items || [];
        
        items.forEach((item: any) => {
          const attributes = item.metadata?.attributes || [];
          const model = attributes.find((a: any) => a.trait_type === 'Model')?.value || 'Standard';
          const backdrop = attributes.find((a: any) => a.trait_type === 'Backdrop')?.value || '#2a2840';
          const symbol = attributes.find((a: any) => a.trait_type === 'Symbol')?.value || 'None';
          
          if (!dbVariants.find(v => v.id === item.address)) {
            dbVariants.push({
              id: item.address,
              collection_id: c.address,
              model_name: model,
              backdrop_color: backdrop,
              symbol_name: symbol,
              rarity_percentage: 5.0,
              image_url: item.metadata?.image || '',
              current_price_gx: 120
            });
          }
        });
      } catch (err) {
        console.error("Failed to fetch items for collection", c.address);
      }
    }
    
    // Ensure our hardcoded gifts are in the DB so the UI works
    for (const g of hardcodedGifts) {
      const existingCol = dbCollections.find(c => c.id === g.id);
      if (!existingCol) {
        dbCollections.push({
          id: g.id,
          name: g.name,
          total_supply: parseInt((g.volume || '10').replace('K', '000')),
          image_url: '',
          floor_price_gx: g.floor
        });
      } else {
        existingCol.floor_price_gx = g.floor;
      }
      
      // Generate some variants if not exist
      const backdrops = ['#ff0000', '#00ff00', '#0000ff', '#f0f0f0', '#2a2a2a'];
      const models = ['Standard', 'Holographic', 'Gold', 'Diamond'];
      
      for(let i = 0; i < 5; i++) {
        const variantId = \`\${g.id}-var-\${i}\`;
        const existingVar = dbVariants.find(v => v.id === variantId);
        if (!existingVar) {
          dbVariants.push({
            id: variantId,
            collection_id: g.id,
            model_name: models[Math.floor(Math.random() * models.length)],
            backdrop_color: backdrops[Math.floor(Math.random() * backdrops.length)],
            symbol_name: 'Original',
            rarity_percentage: parseFloat((Math.random() * 100).toFixed(1)),
            image_url: '',
            current_price_gx: parseFloat((g.floor * (1 + Math.random())).toFixed(2))
          });
        } else {
          // 4. Update floor prices
          existingVar.current_price_gx = parseFloat((g.floor * (1 + (Math.random() * 0.5))).toFixed(2));
        }
      }
    }
    
    console.log(\`Synced \${dbCollections.length} collections and \${dbVariants.length} variants.\`);
  } catch (error) {
    console.error("Sync failed:", error);
  }
};

setInterval(syncTelegramGifts, 300000);
setTimeout(syncTelegramGifts, 1000);

`;

// Insert after imports
code = code.replace("// GIFTS API", interfaces + "\n// GIFTS API\n" + 
`app.get('/api/collections', (req, res) => res.json(dbCollections));
app.get('/api/variants/:collection_id', (req, res) => {
  res.json(dbVariants.filter(v => v.collection_id === req.params.collection_id));
});
`);

fs.writeFileSync('server.ts', code);
