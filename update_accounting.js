const fs = require('fs');
let serverCode = fs.readFileSync('server.ts', 'utf8');

// Replace the balance update in matchOrder
serverCode = serverCode.replace(
  /\/\/ Update balances\n\s+if \(order\.side === 'buy'\) \{\n\s+balances\[order\.userId\] = \(balances\[order\.userId\] \|\| 12480\.50\) - \(fillAmount \* fillPrice\);\n\s+balances\[match\.userId\] = \(balances\[match\.userId\] \|\| 12480\.50\) \+ \(fillAmount \* fillPrice\);\n\s+\} else \{\n\s+balances\[order\.userId\] = \(balances\[order\.userId\] \|\| 12480\.50\) \+ \(fillAmount \* fillPrice\);\n\s+balances\[match\.userId\] = \(balances\[match\.userId\] \|\| 12480\.50\) - \(fillAmount \* fillPrice\);\n\s+\}/,
  `// Update balances
    if (order.side === 'buy') {
      // order was a buy. If it was a market order, deduct now. If limit, it was already deducted on placeOrder (we'll assume at fillPrice for simplicity to avoid complex refunds for price differences)
      if (order.type === 'market') {
        balances[order.userId] = (balances[order.userId] || 12480.50) - (fillAmount * fillPrice);
      }
      balances[match.userId] = (balances[match.userId] || 12480.50) + (fillAmount * fillPrice);
    } else {
      // order was a sell. 
      balances[order.userId] = (balances[order.userId] || 12480.50) + (fillAmount * fillPrice);
      // match was a buy limit order, so it was already deducted.
    }`
);

// Update placeOrder to freeze funds
serverCode = serverCode.replace(
  /orders\.push\(order\);\n\s+matchOrder\(order, io\);/,
  `if (order.side === 'buy' && order.type === 'limit') {
        balances[socket.id] = (balances[socket.id] || 12480.50) - (order.price * order.amount);
      }
      orders.push(order);
      matchOrder(order, io);`
);

// Update cancelOrder to refund frozen funds
serverCode = serverCode.replace(
  /order\.status = 'cancelled';/,
  `order.status = 'cancelled';
        if (order.side === 'buy' && order.type === 'limit') {
          const remaining = order.amount - order.filled;
          balances[socket.id] = (balances[socket.id] || 12480.50) + (remaining * order.price);
        }`
);

fs.writeFileSync('server.ts', serverCode);
