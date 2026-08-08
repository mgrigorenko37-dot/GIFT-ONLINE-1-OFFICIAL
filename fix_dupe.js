const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace("import { gifts as hardcodedGifts } from './src/data/gifts';\nimport { mapTelegramGift } from './src/utils/giftMapper';\nimport { gifts as hardcodedGifts } from './src/data/gifts';", "import { mapTelegramGift } from './src/utils/giftMapper';\nimport { gifts as hardcodedGifts } from './src/data/gifts';");
fs.writeFileSync('server.ts', code);
