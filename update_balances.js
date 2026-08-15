const fs = require('fs');

let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

// Update getBalance
code = code.replace(
  /public async getBalance\(userId: string\): Promise<number> \{[\s\S]*?\}/,
  `public async getBalance(userId: string, currency: string = 'TON'): Promise<number> {
    const res = await this.pool.query('SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2', [userId, currency]);
    if (res.rows.length === 0) return currency === 'TON' ? 12480.5 : 0; // Default
    return Number(res.rows[0].available_balance);
  }`
);

// Update executeTrade balance selection
code = code.replace(
  /const balRes = await client\.query\('SELECT balance FROM te_balances WHERE user_id = \$1 FOR UPDATE', \[order\.userId\]\);/,
  `const currency = 'TON'; // Defaulting to TON for now, could be derived from instrument
      const balRes = await client.query('SELECT available_balance, locked_balance, realized_pnl, total_fees FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE', [order.userId, currency]);`
);

// Update currentBalance reading
code = code.replace(
  /let currentBalance = balRes\.rows\.length > 0 \? Number\(balRes\.rows\[0\]\.balance\) : 12480\.5;/,
  `let currentBalance = balRes.rows.length > 0 ? Number(balRes.rows[0].available_balance) : (currency === 'TON' ? 12480.5 : 0);
      let currentRealizedPnl = balRes.rows.length > 0 ? Number(balRes.rows[0].realized_pnl) : 0;
      let currentTotalFees = balRes.rows.length > 0 ? Number(balRes.rows[0].total_fees) : 0;`
);

// Update balance INSERT/UPDATE
code = code.replace(
  /if \(balRes\.rows\.length === 0\) \{\s*await client\.query\(`INSERT INTO te_balances \(user_id, balance, updated_at\) VALUES \(\$1, \$2, \$3\)`,\s*\[order\.userId, newBalance, Date\.now\(\)\]\);\s*\} else \{\s*await client\.query\(`UPDATE te_balances SET balance=\$1, updated_at=\$2 WHERE user_id=\$3`,\s*\[newBalance, Date\.now\(\), order\.userId\]\);\s*\}/,
  `const nowMs = Date.now();
      if (balRes.rows.length === 0) {
        await client.query(
          \`INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)\`, 
          [order.userId, currency, newBalance, 0, currentTradeRealizedPnl, fee, nowMs, nowMs]
        );
      } else {
        await client.query(
          \`UPDATE te_balances SET available_balance=\$1, realized_pnl=\$2, total_fees=\$3, updated_at=\$4 WHERE user_id=\$5 AND currency=\$6\`, 
          [newBalance, currentRealizedPnl + currentTradeRealizedPnl, currentTotalFees + fee, nowMs, order.userId, currency]
        );
      }`
);

fs.writeFileSync('server/tradingEngine.ts', code);
