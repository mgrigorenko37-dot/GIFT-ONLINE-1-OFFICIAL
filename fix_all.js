const fs = require('fs');

function applyFixes() {
  let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

  // We need a helper method to lock resources
  if (!code.includes('private async lockMarginResources')) {
    const classStart = code.indexOf('export class PostgresTradingEngine {');
    const insertPos = code.indexOf('\n', classStart) + 1;

    const lockHelper = `
  private async lockMarginResources(client: any, userId: string, currency: string) {
    // 1. заблокировать валютный Balance через FOR UPDATE;
    await client.query(
      'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
      [userId, currency]
    );
    // 2. заблокировать Position через FOR UPDATE;
    await client.query(
      'SELECT position_id FROM te_positions WHERE user_id = $1 AND collateral_currency = $2 FOR UPDATE',
      [userId, currency]
    );
    // 3. заблокировать Order через FOR UPDATE;
    await client.query(
      'SELECT order_id FROM te_orders WHERE user_id = $1 AND collateral_currency = $2 FOR UPDATE',
      [userId, currency]
    );
  }
`;
    code = code.substring(0, insertPos) + lockHelper + code.substring(insertPos);
  }

  // Now modify placeOrder
  const placeOrderRegex =
    /(public async placeOrder\([\s\S]*?try \{\n      await client.query\('BEGIN'\);\n)([\s\S]*?)(const now = Date\.now\(\);)/;
  code = code.replace(placeOrderRegex, (match, p1, p2, p3) => {
    // replace inside p2
    let newP2 = p2;
    // remove existing lock of balance
    newP2 = newP2.replace(
      /await client\.query\(\s*'SELECT available_balance FROM te_balances WHERE user_id = \$1 AND currency = \$2 FOR UPDATE',\s*\[order\.userId, order\.collateralCurrency\]\s*\);/g,
      ''
    );
    newP2 = newP2.replace(
      /await client\.query\(\s*'SELECT available_balance FROM te_balances WHERE user_id = \$1 AND currency = \$2 FOR UPDATE',\s*\[orderData\.userId, collateralCurrency\]\s*\);/g,
      ''
    );

    // add lockMarginResources after currencies are defined
    if (!newP2.includes('this.lockMarginResources')) {
      const injectPos =
        newP2.indexOf('const collateralCurrency = instrumentConfig.collateralCurrency;') +
        'const collateralCurrency = instrumentConfig.collateralCurrency;'.length;
      newP2 =
        newP2.substring(0, injectPos) +
        '\n      await this.lockMarginResources(client, orderData.userId, collateralCurrency);\n' +
        newP2.substring(injectPos);
    }

    // modify posRes to not use FOR UPDATE since we already locked all positions, but it doesn't hurt.
    // Actually we'll just leave it.

    return p1 + newP2 + p3;
  });

  // Now modify cancelOrder
  const cancelOrderRegex =
    /(public async cancelOrder\([\s\S]*?try \{\n      await client.query\('BEGIN'\);\n)([\s\S]*?)(const orderRes = await client\.query\(\s*'SELECT \* FROM te_orders WHERE order_id = \$1 FOR UPDATE',\s*\[orderId\]\s*\);)/;
  code = code.replace(cancelOrderRegex, (match, p1, p2, p3) => {
    let newP2 = p2;
    if (!newP2.includes('initialOrderRes')) {
      newP2 = `
      const initialOrderRes = await client.query('SELECT user_id, instrument_key, collateral_currency FROM te_orders WHERE order_id = $1', [orderId]);
      if (initialOrderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const initialOrder = initialOrderRes.rows[0];
      const currency = initialOrder.collateral_currency || getInstrumentConfig(initialOrder.instrument_key).collateralCurrency;
      await this.lockMarginResources(client, initialOrder.user_id, currency);
`;
    }
    return p1 + newP2 + p3;
  });

  // Also remove the old balance lock from cancelOrder
  code = code.replace(
    /await client\.query\(\s*'SELECT available_balance FROM te_balances WHERE user_id = \$1 AND currency = \$2 FOR UPDATE',\s*\[order\.userId, order\.collateralCurrency\]\s*\);/g,
    ''
  );

  // Now modify executeTrade
  // It starts with:
  // try {
  //   await client.query('BEGIN');
  //   const execCheck = ...
  const execStartRegex =
    /(public async executeTrade[\s\S]*?try \{\n      await client.query\('BEGIN'\);\n)([\s\S]*?)(const orderRes = await client\.query\(\s*'SELECT \* FROM te_orders WHERE order_id = \$1 FOR UPDATE',\s*\[orderId\]\s*\);)/;
  code = code.replace(execStartRegex, (match, p1, p2, p3) => {
    let newP2 = p2;
    if (!newP2.includes('initialOrderRes')) {
      const execCheckMatch = newP2.match(
        /const execCheck[\s\S]*?if \(options\?\.source && options\?\.externalExecutionId\) \{[\s\S]*?return null;\n\s*\}\n\s*\}/
      );
      const execCheckStr = execCheckMatch ? execCheckMatch[0] : '';

      newP2 = `
      const initialOrderRes = await client.query('SELECT user_id, instrument_key, collateral_currency FROM te_orders WHERE order_id = $1', [orderId]);
      if (initialOrderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const initialOrder = initialOrderRes.rows[0];
      const currency = initialOrder.collateral_currency || getInstrumentConfig(initialOrder.instrument_key).collateralCurrency;

      await this.lockMarginResources(client, initialOrder.user_id, currency);

      ${execCheckStr}
`;
    }
    return p1 + newP2 + p3;
  });

  // Remove the posRes query from executeTrade since it's already locked? No, we still need posRes to read it. Just leave it.
  // Remove the balRes query from executeTrade completely
  const balResRegex =
    /const balRes = await client\.query\(\s*'SELECT available_balance, locked_balance, realized_pnl, total_fees FROM te_balances WHERE user_id = \$1 AND currency = \$2 FOR UPDATE',\s*\[order\.userId, currency\]\s*\);/g;
  code = code.replace(
    balResRegex,
    `const balRes = await client.query('SELECT available_balance, locked_balance, realized_pnl, total_fees FROM te_balances WHERE user_id = $1 AND currency = $2', [order.userId, currency]);`
  );

  // Fix the calculateMargin logic that I injected earlier with patch_margin.js
  const calcMarginFix = `const updatedMargin = await this.calculateMargin(client, order.userId, currency);
      const newEquity = newBalance + updatedMargin.totalUnrealizedPnl;
      const newAvailableBalance = newEquity - updatedMargin.usedMargin;

      if (newAvailableBalance < 0 && order.positionEffect === 'Open') {
        await client.query('ROLLBACK TO SAVEPOINT execute_start_sp');
        
        order.status = 'Rejected';
        order.rejectionReason = \`Insufficient margin: required \${updatedMargin.usedMargin.toFixed(2)}, available \${newEquity.toFixed(2)}\`;
        order.updatedAt = Date.now();
        
        await client.query(
          \`UPDATE te_orders SET status=$1, rejection_reason=$2, updated_at=$3 WHERE order_id=$4\`,
          [order.status, order.rejectionReason, order.updatedAt, order.orderId]
        );
        
        await client.query(
          \`INSERT INTO te_executions (execution_id, order_id, user_id, instrument_key, side, requested_qty, fill_qty, fill_price, fee, settlement_currency, fee_currency, pnl_currency, status, created_at, processed_at, source, external_execution_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)\`,
          [
            actualExecutionId,
            orderId,
            order.userId,
            order.instrumentKey,
            order.side,
            fillQty,
            0,
            0,
            0,
            settlementCurrency,
            feeCurrency,
            pnlCurrency,
            'REJECTED',
            Date.now(),
            Date.now(),
            options?.source || null,
            options?.externalExecutionId || null,
          ]
        );
        await client.query('COMMIT');
        return null;
      }
      
      const newLockedBalance = updatedMargin.usedMargin;`;

  const oldMarginLogic = `const updatedMargin = await this.calculateMargin(client, order.userId, currency);
      const newLockedBalance = updatedMargin.usedMargin;`;

  if (code.includes(oldMarginLogic)) {
    code = code.replace(oldMarginLogic, calcMarginFix);
  }

  // Also fix the execute_start_sp part
  const executeUpdateOrder = `await client.query(
        \`UPDATE te_orders SET status=$1, executed_qty=$2, remaining_qty=$3, avg_fill_price=$4, fee=$5, updated_at=$6, rejection_reason=$7 WHERE order_id=$8\`,`;
  const withSavepoint = `await client.query('SAVEPOINT execute_start_sp');\n      await client.query(\n        \`UPDATE te_orders SET status=$1, executed_qty=$2, remaining_qty=$3, avg_fill_price=$4, fee=$5, updated_at=$6, rejection_reason=$7 WHERE order_id=$8\`,`;

  if (code.includes(executeUpdateOrder) && !code.includes(withSavepoint)) {
    code = code.replace(executeUpdateOrder, withSavepoint);
  }

  // Fix PNL Currency in executeTrade for REJECTED
  code = code.replace(
    /order\.feeCurrency,\s+'REJECTED',/g,
    "order.feeCurrency,\n              order.pnlCurrency || order.settlementCurrency,\n              'REJECTED',"
  );
  code = code.replace(/15, \$16\)/g, '15, $16, $17)');

  fs.writeFileSync('server/tradingEngine.ts', code);
  console.log('Fixes applied successfully.');
}

applyFixes();
