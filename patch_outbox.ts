import fs from 'fs';
let code = fs.readFileSync('server/tradingOutboxWorker.ts', 'utf8');

// Undo the crash patch
const target =
  "if (process.env.CRASH_BEFORE_EMIT) { console.log('[Outbox Worker] CRASHING BEFORE MARKING PUBLISHED FOR ' + event_type); process.exit(1); }\n      await client.query(\n        `UPDATE te_outbox_events SET status = 'published', published_at = $1 WHERE id = $2`,\n        [Date.now(), id]\n      );";
const replacement =
  "await client.query(\n        `UPDATE te_outbox_events SET status = 'published', published_at = $1 WHERE id = $2`,\n        [Date.now(), id]\n      );";

code = code.replace(target, replacement);

fs.writeFileSync('server/tradingOutboxWorker.ts', code);
