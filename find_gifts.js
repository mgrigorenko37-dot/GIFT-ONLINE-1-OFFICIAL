const https = require('https');

const fetchPage = (offset) => {
  return new Promise((resolve) => {
    https.get(`https://tonapi.io/v2/nfts/collections?limit=100&offset=${offset}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).nft_collections || []); } catch(e) { resolve([]); }
      });
    });
  });
};

const run = async () => {
  for (let i = 0; i < 20; i++) {
    const cols = await fetchPage(i * 100);
    const tg = cols.filter(c => c.name && (c.name.toLowerCase().includes('gift') || c.name.toLowerCase().includes('telegram')));
    tg.forEach(c => console.log(c.name, c.address, c.metadata?.image));
    if (cols.length === 0) break;
  }
};
run();
