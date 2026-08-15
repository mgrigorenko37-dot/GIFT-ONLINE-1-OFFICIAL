const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

const placeOrderBodyStart = code.indexOf('public async placeOrder(');
const placeOrderBodyEnd = code.indexOf('public async cancelOrder(', placeOrderBodyStart);

let placeOrderCode = code.substring(placeOrderBodyStart, placeOrderBodyEnd);

// In placeOrder, we want to lock Balance, then Position, then we don't lock Order because we are about to insert it, but we can lock it if we want. Wait, we don't have order_id yet.
// Currently it does:
// 1. SELECT FOR UPDATE on te_positions
// 2. Insert te_orders
// 3. SELECT FOR UPDATE on te_balances
// 4. calculateMargin

const targetCode = `    try {
      await client.query('BEGIN');
      const instrumentConfig = getInstrumentConfig(orderData.instrumentKey);
      const settlementCurrency = instrumentConfig.settlementCurrency;
      const feeCurrency = instrumentConfig.feeCurrency;
      const pnlCurrency = instrumentConfig.pnlCurrency;
      const collateralCurrency = instrumentConfig.collateralCurrency;

      // 1. заблокировать валютный Balance через FOR UPDATE;
      await client.query(
        'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
        [orderData.userId, collateralCurrency]
      );

      // 2. заблокировать Position через FOR UPDATE;
      const posRes = await client.query(
        'SELECT * FROM te_positions WHERE user_id = $1 AND instrument_key = $2 FOR UPDATE',
        [orderData.userId, orderData.instrumentKey]
      );`;

const oldTryStart = placeOrderCode.indexOf("    try {\n      await client.query('BEGIN');");
const oldPosResEnd = placeOrderCode.indexOf("];\n      }") + "];\n      }".length; // this is inside `if (posRes.rows.length > 0) { position = posRes.rows[0]; }`
// Actually, let's just replace the top part until `const now = Date.now();`

let oldNowStart = placeOrderCode.indexOf("const now = Date.now();", oldTryStart);
let topPartOld = placeOrderCode.substring(oldTryStart, oldNowStart);

placeOrderCode = placeOrderCode.substring(0, oldTryStart) + targetCode + `
      let position = null;
      if (posRes.rows.length > 0) {
        position = {
          side: posRes.rows[0].side,
        };
      }

      ` + placeOrderCode.substring(oldNowStart);

// Remove the old balance lock:
// await client.query(
//   'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
//   [order.userId, order.collateralCurrency]
// );
const oldBalLock = `await client.query(
          'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
          [order.userId, order.collateralCurrency]
        );`;
placeOrderCode = placeOrderCode.replace(oldBalLock, "");

code = code.substring(0, placeOrderBodyStart) + placeOrderCode + code.substring(placeOrderBodyEnd);
fs.writeFileSync('server/tradingEngine.ts', code);
