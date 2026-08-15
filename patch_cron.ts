import fs from 'fs';
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

if (!code.includes('SchedulerLease')) {
    code = "import { SchedulerLease } from './schedulerLease';\n" + code;
    
    const target = "async function runFunding() {\n      try {\n        const nowMs = Date.now();\n        await this.engine.processMissedFundingPeriods({\n          currentTimestamp: nowMs,\n          intervalMs: 8 * 60 * 60 * 1000\n        });\n      } catch (err) {\n        console.error('[FundingWorker] Error in runFunding:', err);\n      }\n    }";
    
    const replacement = `async function runFunding() {
      try {
        const nowMs = Date.now();
        const intervalMs = 8 * 60 * 60 * 1000;
        const alignedTimestamp = Math.floor(nowMs / intervalMs) * intervalMs;
        const lease = new SchedulerLease(this.pool);
        const lockClient = await lease.tryAcquireLock('FUNDING', String(alignedTimestamp));
        if (!lockClient) return; // Another instance is running this
        try {
          await this.engine.processMissedFundingPeriods({
            currentTimestamp: nowMs,
            intervalMs: intervalMs
          });
        } finally {
          await lease.releaseLock(lockClient, 'FUNDING', String(alignedTimestamp));
        }
      } catch (err) {
        console.error('[FundingWorker] Error in runFunding:', err);
      }
    }`;

    code = code.replace(target, replacement);
    fs.writeFileSync('server/tradingEngine.ts', code);
    console.log('Cron patched');
}
