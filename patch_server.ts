import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

if (code.includes('processMissedFundingPeriods')) {
   const target = `    const res = await engine.processMissedFundingPeriods({\n      currentTimestamp: nowMs,\n      intervalMs: 8 * 60 * 60 * 1000\n    });`;
   
   if (code.includes('SchedulerLease')) {
       console.log('Already patched');
       process.exit(0);
   }

   const replacement = `    const lease = new import_schedulerLease.SchedulerLease(pool);
    const intervalMs = 8 * 60 * 60 * 1000;
    const alignedTimestamp = Math.floor(nowMs / intervalMs) * intervalMs;
    const lockClient = await lease.tryAcquireLock('FUNDING_CATCHUP', String(alignedTimestamp));
    if (!lockClient) return; // Another node is doing it
    try {
      const res = await engine.processMissedFundingPeriods({
        currentTimestamp: nowMs,
        intervalMs: intervalMs
      });`;

   const targetEnd = `    } catch (err) {\n      console.error('[FundingWorker] Error processing funding:', err);\n    }\n  }`;
   const replacementEnd = `    } finally { await lease.releaseLock(lockClient, 'FUNDING_CATCHUP', String(alignedTimestamp)); }
    } catch (err) {\n      console.error('[FundingWorker] Error processing funding:', err);\n    }\n  }`;

   code = "import * as import_schedulerLease from './server/schedulerLease';\n" + code;
   code = code.replace(target, replacement);
   code = code.replace(targetEnd, replacementEnd);
   fs.writeFileSync('server.ts', code);
   console.log('Server patched');
} else {
   console.log('Could not find funding invocation in server.ts');
}
