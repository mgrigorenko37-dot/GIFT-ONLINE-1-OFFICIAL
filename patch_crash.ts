import fs from 'fs';
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');
code = code.replace(
  "if (ownClient) {\n        await client.query('COMMIT');\n      }",
  "if (ownClient) {\n        if (process.env.CRASH_BEFORE_COMMIT) {\n          console.log('[Worker] CRASHING BEFORE COMMIT!!!');\n          process.exit(1);\n        }\n        await client.query('COMMIT');\n      }"
);
fs.writeFileSync('server/tradingEngine.ts', code);
