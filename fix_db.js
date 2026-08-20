const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace(
  /app\.get\('\/api\/testdb', async \(req,res\) => \{[\s\S]*?\}\);/g,
  "app.get('/api/testdb', async (req,res) => { try { const client = await getPgPool().connect(); await client.query('CREATE TABLE IF NOT EXISTS gift_collections (id SERIAL PRIMARY KEY, ton_collection_address TEXT UNIQUE NOT NULL, name TEXT NOT NULL, is_nft BOOLEAN DEFAULT true, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now())'); await client.query('CREATE TABLE IF NOT EXISTS gift_variants (id SERIAL PRIMARY KEY, collection_id INTEGER REFERENCES gift_collections(id), nft_address TEXT UNIQUE, model_name TEXT, symbol_name TEXT, backdrop_name TEXT, rarity_percentage NUMERIC, current_price_gx NUMERIC, image_url TEXT, metadata_raw JSONB, last_synced_at TIMESTAMPTZ DEFAULT now())'); const r = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\\'public\\''); res.json(r.rows); client.release(); } catch(e) { res.status(500).json({error: e.message}); } });"
);
fs.writeFileSync('server.ts', code, 'utf8');
