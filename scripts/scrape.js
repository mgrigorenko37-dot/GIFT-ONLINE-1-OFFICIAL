const https = require('https');

const fetchUrl = (url) =>
  new Promise((res) => {
    https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } },
      (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(d));
      }
    );
  });

fetchUrl('https://getgems.io/telegram-gifts').then((d) => {
  const matches = d.match(/<title>.*?<\/title>/g);
  console.log(matches);
});
