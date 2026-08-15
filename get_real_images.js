const https = require('https');

const searchTonApi = async (query) => {
  return new Promise((resolve) => {
    https.get(
      `https://tonapi.io/v2/nfts/search?collection=${encodeURIComponent(query)}&limit=1`,
      (res) => {
        // This endpoint doesn't exist
        resolve(null);
      }
    );
  });
};

// I will just fetch 100 recent NFTs transferred or something?
// Or I can use TonAPI's account endpoint if I know someone who owns gifts...
