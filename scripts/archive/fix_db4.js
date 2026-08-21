const fs = require('fs');
let code = fs.readFileSync('server/dbSchema.ts', 'utf-8');
code = code.replace(
  /CREATE TABLE IF NOT EXISTS te_executions \([\s\S]*?created_at BIGINT NOT NULL\);/m,
  (match) => {
    return match.replace(/UNIQUE\(user_id, instrument_key\),\s*/, '');
  }
);

// Actually, what are the missing columns for te_executions?
// requested_qty, filled_qty, remaining_qty?
// Let's just extract what the code expects for te_executions
