const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

const cancelOrderStart = code.indexOf('public async cancelOrder(');
const cancelOrderEnd = code.indexOf('public async executeTrade(', cancelOrderStart);

let cancelCode = code.substring(cancelOrderStart, cancelOrderEnd);

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
      await client.query(
        'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
        [initialOrder.user_id, currency]
      );

      // 2. заблокировать Position через FOR UPDATE;
      await client.query(
        'SELECT * FROM te_positions WHERE user_id = $1 AND instrument_key = $2 FOR UPDATE',
        [initialOrder.user_id, initialOrder.instrument_key]
      );

      // 3. заблокировать Order через FOR UPDATE;
      const orderRes = await client.query('SELECT * FROM te_orders WHERE order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }`;

const oldTryStart = cancelCode.indexOf("    try {\n      await client.query('BEGIN');");
const oldOrderResEnd = cancelCode.indexOf("if (orderRes.rows.length === 0) {\n        await client.query('ROLLBACK');\n        return null;\n      }") + "if (orderRes.rows.length === 0) {\n        await client.query('ROLLBACK');\n        return null;\n      }".length;

cancelCode = cancelCode.substring(0, oldTryStart) + targetCode + cancelCode.substring(oldOrderResEnd);

// Remove the old balance lock which was later
const oldBalLock = `await client.query(
          'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
          [order.userId, order.collateralCurrency]
        );`;
cancelCode = cancelCode.replace(oldBalLock, "");

code = code.substring(0, cancelOrderStart) + cancelCode + code.substring(cancelOrderEnd);
fs.writeFileSync('server/tradingEngine.ts', code);
