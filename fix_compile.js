const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

code = code.replace(/import crypto from 'crypto';/g, "import * as crypto from 'crypto';");

if (!code.includes('import { parseInstrumentKey }')) {
  // Try to find if it's imported elsewhere, or just add it
  if (code.includes('import { getInstrumentConfig }')) {
    code = code.replace(/import { getInstrumentConfig }/g, "import { getInstrumentConfig, parseInstrumentKey }");
  } else {
    code = code.replace(/import { getInstrumentConfig/g, "import { getInstrumentConfig, parseInstrumentKey");
  }
}

fs.writeFileSync('server/tradingEngine.ts', code);
