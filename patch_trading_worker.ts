import fs from 'fs';

let code = fs.readFileSync('server/tradingWorker.ts', 'utf8');

if (!code.includes('SchedulerLease')) {
  // Add imports
  code = "import { SchedulerLease } from './schedulerLease';\n" + code;
  
  // Update processFunding
  const target = "async function processFunding() {\n  console.log('[FundingWorker] Checking for missed funding periods...');\n  try {\n    const engine = new PostgresTradingEngine(pool);\n    const nowMs = Date.now();\n    \n    const res = await engine.processMissedFundingPeriods({\n      currentTimestamp: nowMs,\n      intervalMs: 8 * 60 * 60 * 1000\n    });";

  const replacement = `async function processFunding() {
  console.log('[FundingWorker] Checking for missed funding periods...');
  try {
    const engine = new PostgresTradingEngine(pool);
    const lease = new SchedulerLease(pool);
    const nowMs = Date.now();
    
    // Align timestamp to 8h interval
    const intervalMs = 8 * 60 * 60 * 1000;
    const alignedTimestamp = Math.floor(nowMs / intervalMs) * intervalMs;
    
    const lockClient = await lease.tryAcquireLock('FUNDING_CATCHUP', String(alignedTimestamp));
    if (!lockClient) {
      console.log('[FundingWorker] Another instance is currently processing funding for timestamp ' + alignedTimestamp + '. Skipping.');
      return; // Skip execution, lock held by another process
    }
    
    try {
       const res = await engine.processMissedFundingPeriods({
         currentTimestamp: nowMs,
         intervalMs: intervalMs
       });`;

  code = code.replace(target, replacement);
  
  // Close the try/finally block
  const targetEnd = "}\n  } catch (err) {\n    console.error('[FundingWorker] Error processing funding:', err);\n  }";
  const replacementEnd = `}\n    } finally {\n       await lease.releaseLock(lockClient, 'FUNDING_CATCHUP', String(alignedTimestamp));\n    }\n  } catch (err) {\n    console.error('[FundingWorker] Error processing funding:', err);\n  }`;
  code = code.replace(targetEnd, replacementEnd);
  
  fs.writeFileSync('server/tradingWorker.ts', code);
  console.log('Worker patched');
}
