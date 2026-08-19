const fs = require('fs');
let code = fs.readFileSync('src/screens/Capital/CapitalScreen.tsx', 'utf8');

code = code.replace(/<GiftArtwork className=\{gift\.className\} large emoji=\{gift\.emoji\} \/>/g, "<GiftArtwork className={gift.className} large emoji={gift.emoji} image_url={gift.image_url} />");
fs.writeFileSync('src/screens/Capital/CapitalScreen.tsx', code, 'utf8');
