const fs = require('fs');
let serverCode = fs.readFileSync('server.ts', 'utf8');

serverCode = serverCode.replace(
  /match\.filled \+= fillAmount;\n\s+order\.filled \+= fillAmount;\n\s+remainingToFill -= fillAmount;/,
  `match.filled += fillAmount;
    order.filled += fillAmount;
    remainingToFill -= fillAmount;
    
    // Update balances
    if (order.side === 'buy') {
      balances[order.userId] = (balances[order.userId] || 12480.50) - (fillAmount * fillPrice);
      balances[match.userId] = (balances[match.userId] || 12480.50) + (fillAmount * fillPrice);
    } else {
      balances[order.userId] = (balances[order.userId] || 12480.50) + (fillAmount * fillPrice);
      balances[match.userId] = (balances[match.userId] || 12480.50) - (fillAmount * fillPrice);
    }`
);

// update subscribe
serverCode = serverCode.replace(
  /socket\.emit\('userOrders', orders\.filter\(\(o\) => o\.userId === socket\.id\)\);\n\s+\}\);/,
  `socket.emit('userOrders', orders.filter((o) => o.userId === socket.id));
      socket.emit('balance', balances[socket.id] || 12480.50);
    });`
);

// update placeOrder
serverCode = serverCode.replace(
  /socket\.emit\(\n\s+'userOrders',\n\s+orders\.filter\(\(o\) => o\.userId === socket\.id\)\n\s+\);\n\s+socket\.emit\('orderPlaced', order\);\n\s+\}\);/,
  `socket.emit('userOrders', orders.filter((o) => o.userId === socket.id));
      socket.emit('orderPlaced', order);
      socket.emit('balance', balances[socket.id] || 12480.50);
    });`
);

// update cancelOrder
serverCode = serverCode.replace(
  /socket\.emit\('userOrders', orders\.filter\(\(o\) => o\.userId === socket\.id\)\);\n\s+\}\n\s+\}\);/,
  `socket.emit('userOrders', orders.filter((o) => o.userId === socket.id));
        socket.emit('balance', balances[socket.id] || 12480.50);
      }
    });`
);

fs.writeFileSync('server.ts', serverCode);
