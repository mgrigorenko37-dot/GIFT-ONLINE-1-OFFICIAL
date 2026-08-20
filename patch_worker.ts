import fs from 'fs';

let code = fs.readFileSync('server/tradingWorker.ts', 'utf8');

// Add import
if (!code.includes('SchedulerLease')) {
  code = "import { SchedulerLease } from './schedulerLease';\n" + code;
}

const target = `  try {
    const engine = new PostgresTradingEngine(pool);
    const nowMs = Date.now();
    
    const res = await engine.processMissedFundingPeriods({
      currentTimestamp: nowMs,
      intervalMs: 8 * 60 * 60 * 1000
    });`;

const replacement = `  try {
    const engine = new PostgresTradingEngine(pool);
    const lease = new SchedulerLease(pool);
    const nowMs = Date.now();
    
    const intervalMs = 8 * 60 * 60 * 1000;
    const alignedTimestamp = Math.floor(nowMs / intervalMs) * intervalMs;
    
    const lockClient = await lease.tryAcquireLock('FUNDING_JOB', String(alignedTimestamp));
    
    if (!lockClient) {
       console.log('[FundingWorker] Lock held by another node. Skipping.');
       return;
    }
    
    try {
      const res = await engine.processMissedFundingPeriods({
        currentTimestamp: nowMs,
        intervalMs: intervalMs
      });`;

const targetEnd = `  } catch (err) {
    console.error('[FundingWorker] Error processing funding:', err);
  }`;

const replacementEnd = `    } finally {
       await lease.releaseLock(lockClient, 'FUNDING_JOB', String(alignedTimestamp));
    }
  } catch (err) {
    console.error('[FundingWorker] Error processing funding:', err);
  }`;

if (code.includes(target) && code.includes(targetEnd)) {
  code = code.replace(target, replacement);
  code = code.replace(targetEnd, replacementEnd);
  fs.writeFileSync('server/tradingWorker.ts', code);
  console.log('Worker patched successfully');
} else {
  console.log('Could not find targets');
}
