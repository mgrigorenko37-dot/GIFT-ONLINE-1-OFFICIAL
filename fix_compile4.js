const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

if (!code.includes("import { parseInstrumentKey } from '../src/types/market';")) {
  code = "import { parseInstrumentKey } from '../src/types/market';\n" + code;
}

fs.writeFileSync('server/tradingEngine.ts', code);
