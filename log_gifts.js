const https = require('https');
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log('No token');
  process.exit(1);
}
https.get(`https://api.telegram.org/bot${token}/getAvailableGifts`, (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => console.log(d));
});
