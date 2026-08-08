const https = require('https');

const search = (q) => {
  https.get(`https://tonapi.io/v2/nfts/search?collection=${encodeURIComponent(q)}&limit=1`, (res) => { // Does not exist
    let b = '';
    res.on('data', d=>b+=d);
    res.on('end', ()=>console.log(b));
  })
}
