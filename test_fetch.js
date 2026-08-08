const https = require('https');
https.get("https://tonapi.io/v2/nfts/collections?limit=50", (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const gifts = json.nft_collections.filter(c => c.name && c.name.toLowerCase().includes('gift'));
    console.log("Found gifts:", gifts.length);
  });
});
