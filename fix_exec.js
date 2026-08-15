const fs = require('fs');
let code = fs.readFileSync('server/tradingEngine.ts', 'utf8');

// I will insert a try/catch logging around executeTrade or just log at every null return
let modified = code
  .replace(
    "if (orderRes.rows.length === 0) {\n        await client.query('ROLLBACK');\n        return null;\n      }",
    "if (orderRes.rows.length === 0) {\n console.log('null at 1');       await client.query('ROLLBACK');\n        return null;\n      }"
  )
  .replace(
    "if (order.status !== 'Open' && order.status !== 'PartiallyFilled') {\n        await client.query('ROLLBACK');\n        return null;\n      }",
    "if (order.status !== 'Open' && order.status !== 'PartiallyFilled') {\n console.log('null at 2');       await client.query('ROLLBACK');\n        return null;\n      }"
  )
  .replace(
    "if (fillQty <= 0) {\n        await client.query('ROLLBACK');\n        return null;\n      }",
    "if (fillQty <= 0) {\n console.log('null at 3', fillQty);       await client.query('ROLLBACK');\n        return null;\n      }"
  )
  .replace(
    "if (fillQty === 0) {\n        await client.query('ROLLBACK');\n        return null;\n      }",
    "if (fillQty === 0) {\n console.log('null at 4', fillQty);       await client.query('ROLLBACK');\n        return null;\n      }"
  );
fs.writeFileSync('server/tradingEngine.ts', modified);
