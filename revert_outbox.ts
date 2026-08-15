import fs from 'fs';
let code = fs.readFileSync('server/tradingOutboxWorker.ts', 'utf8');

const replacement = "if (process.env.CRASH_BEFORE_EMIT) { console.log('[Outbox Worker] CRASHING BEFORE MARKING PUBLISHED FOR ' + event_type); process.exit(1); }\n      await client.query(\n        `UPDATE te_outbox_events SET status = 'published', published_at = $1 WHERE id = $2`,\n        [Date.now(), id]\n      );";
const target = "await client.query(\n        `UPDATE te_outbox_events SET status = 'published', published_at = $1 WHERE id = $2`,\n        [Date.now(), id]\n      );";

code = code.replace(replacement, target);

fs.writeFileSync('server/tradingOutboxWorker.ts', code);
