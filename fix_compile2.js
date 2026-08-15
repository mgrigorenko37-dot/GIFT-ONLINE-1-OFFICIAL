const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

code = code.replace(
  "const config = getInstrumentConfig(orderData.instrument      await this.lockMarginResources(client, orderData.userId, collateralCurrency);Key);",
  "const config = getInstrumentConfig(orderData.instrumentKey);"
);

// We need to make sure lockMarginResources is inserted correctly in placeOrder.
const injectPos = "const collateralCurrency = orderData.collateralCurrency || config.collateralCurrency;";
code = code.replace(injectPos, injectPos + '\n      await this.lockMarginResources(client, orderData.userId, collateralCurrency);\n');

fs.writeFileSync('server/tradingEngine.ts', code);
