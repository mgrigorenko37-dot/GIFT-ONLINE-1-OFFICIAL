const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

const executeTradeBodyStart = code.indexOf('public async executeTrade(');
const executeTradeBodyEnd = code.indexOf('  public async getAllPositions(', executeTradeBodyStart);

let executeTradeCode = code.substring(executeTradeBodyStart, executeTradeBodyEnd);

// We need to rewrite the beginning of try block in executeTrade
// Currently it does:
// try {
//   await client.query('BEGIN');
//   const execCheck = ...

const targetCode = `    try {
      await client.query('BEGIN');

      const initialOrderRes = await client.query('SELECT user_id, instrument_key, collateral_currency FROM te_orders WHERE order_id = $1', [orderId]);
      if (initialOrderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const initialOrder = initialOrderRes.rows[0];
      const currency = initialOrder.collateral_currency || getInstrumentConfig(initialOrder.instrument_key).collateralCurrency;

      // 1. заблокировать валютный Balance через FOR UPDATE;
      const balRes = await client.query(
        'SELECT available_balance, locked_balance, realized_pnl, total_fees FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
        [initialOrder.user_id, currency]
      );

      // 2. заблокировать Position через FOR UPDATE;
      const posRes = await client.query(
        'SELECT * FROM te_positions WHERE user_id = $1 AND instrument_key = $2 FOR UPDATE',
        [initialOrder.user_id, initialOrder.instrument_key]
      );

      // 3. заблокировать Order через FOR UPDATE;
      const orderRes = await client.query(
        'SELECT * FROM te_orders WHERE order_id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const order = this.mapOrder(orderRes.rows[0]);

      const execCheck = await client.query(
        'SELECT * FROM te_executions WHERE execution_id = $1 FOR UPDATE',
        [actualExecutionId]
      );

      if (execCheck.rows.length > 0) {
        const existingExec = execCheck.rows[0];
        if (
          Number(existingExec.fill_qty) === fillQty &&
          Number(existingExec.fill_price) === fillPrice &&
          existingExec.order_id === orderId
        ) {
          await client.query('ROLLBACK');
          return null; // Already processed
        } else {
          await client.query('ROLLBACK');
          throw new Error('Conflict: execution_id already exists with different data');
        }
      }

      if (options?.source && options?.externalExecutionId) {
        const extCheck = await client.query(
          'SELECT * FROM te_executions WHERE source = $1 AND external_execution_id = $2 FOR UPDATE',
          [options.source, options.externalExecutionId]
        );
        if (extCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return null;
        }
      }

      if (order.status !== 'Open' && order.status !== 'PartiallyFilled') {
        await client.query('ROLLBACK');
        return null;
      }`;

const oldTryStart = executeTradeCode.indexOf("    try {\n      await client.query('BEGIN');");
const oldOrderCheckEnd = executeTradeCode.indexOf(
  "if (order.status !== 'Open' && order.status !== 'PartiallyFilled') {\n        await client.query('ROLLBACK');\n        return null;\n      }"
);
const oldOrderCheckEndFull =
  oldOrderCheckEnd +
  "if (order.status !== 'Open' && order.status !== 'PartiallyFilled') {\n        await client.query('ROLLBACK');\n        return null;\n      }"
    .length;

executeTradeCode =
  executeTradeCode.substring(0, oldTryStart) +
  targetCode +
  executeTradeCode.substring(oldOrderCheckEndFull);

// We must also remove the old balRes query which was lower down!
const oldBalResStart = executeTradeCode.indexOf(
  "const balRes = await client.query(\n        'SELECT available_balance"
);
if (oldBalResStart !== -1) {
  const oldBalResEnd = executeTradeCode.indexOf(';', oldBalResStart) + 1;
  executeTradeCode =
    executeTradeCode.substring(0, oldBalResStart) + executeTradeCode.substring(oldBalResEnd);
}

// Remove "const currency = collateralCurrency;" since we defined it at the top
executeTradeCode = executeTradeCode.replace('const currency = collateralCurrency;', '');

code =
  code.substring(0, executeTradeBodyStart) + executeTradeCode + code.substring(executeTradeBodyEnd);
fs.writeFileSync('server/tradingEngine.ts', code);
