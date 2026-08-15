import fs from 'fs';
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

const replaceStr = `        results.push(payment);
      }

      if (ownClient) {
        if (process.env.CRASH_BEFORE_COMMIT) {
           console.log('[Worker] CRASHING BEFORE FUNDING COMMIT!!!');
           process.exit(1);
        }
        await client.query('COMMIT');
      }`;
      
const targetStr = `        results.push(payment);
      }

      if (ownClient) {
        await client.query('COMMIT');
      }`;

code = code.replace(replaceStr, targetStr);
fs.writeFileSync('server/tradingEngine.ts', code);
