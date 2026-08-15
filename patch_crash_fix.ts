import fs from 'fs';
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

// Undo the wrong patch
code = code.replace(
  "if (ownClient) {\n        if (process.env.CRASH_BEFORE_COMMIT) {\n          console.log('[Worker] CRASHING BEFORE COMMIT!!!');\n          process.exit(1);\n        }\n        await client.query('COMMIT');\n      }",
  "if (ownClient) {\n        await client.query('COMMIT');\n      }"
);

// Do the right patch
const targetStr = `        results.push(payment);
      }

      if (ownClient) {
        await client.query('COMMIT');
      }`;
      
const replaceStr = `        results.push(payment);
      }

      if (ownClient) {
        if (process.env.CRASH_BEFORE_COMMIT) {
           console.log('[Worker] CRASHING BEFORE FUNDING COMMIT!!!');
           process.exit(1);
        }
        await client.query('COMMIT');
      }`;

if (code.includes(targetStr)) {
   code = code.replace(targetStr, replaceStr);
} else {
   console.log('Target string not found');
}

fs.writeFileSync('server/tradingEngine.ts', code);
