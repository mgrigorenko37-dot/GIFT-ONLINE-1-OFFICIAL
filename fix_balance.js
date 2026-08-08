const fs = require('fs');
let serverCode = fs.readFileSync('server.ts', 'utf8');

serverCode = serverCode.replace(
  /const orders: Order\[\] = \[\];\nconst trades: Trade\[\] = \[\];/,
  'const orders: Order[] = [];\nconst trades: Trade[] = [];\nconst balances: Record<string, number> = {};'
);

serverCode = serverCode.replace(
  /    match\.filled \+= fillAmount;\n    order\.filled \+= fillAmount;\n    remainingToFill -= fillAmount;/,
  "    match.filled += fillAmount;\n    order.filled += fillAmount;\n    remainingToFill -= fillAmount;\n\n    // Update balances\n    if (order.side === 'buy') {\n      balances[order.userId] = (balances[order.userId] || 12480.50) - (fillAmount * fillPrice);\n      balances[match.userId] = (balances[match.userId] || 12480.50) + (fillAmount * fillPrice);\n    } else {\n      balances[order.userId] = (balances[order.userId] || 12480.50) + (fillAmount * fillPrice);\n      balances[match.userId] = (balances[match.userId] || 12480.50) - (fillAmount * fillPrice);\n    }"
);

serverCode = serverCode.replace(
  /      socket\.emit\('userOrders', orders\.filter\(o => o\.userId === socket\.id\)\);\n    \}\);/,
  "      socket.emit('userOrders', orders.filter(o => o.userId === socket.id));\n      socket.emit('balance', balances[socket.id] || 12480.50);\n      if (match.userId !== 'system') {\n        io.to(match.userId).emit('balance', balances[match.userId] || 12480.50);\n      }\n    });"
);

serverCode = serverCode.replace(
  /      socket\.emit\('userOrders', orders\.filter\(o => o\.userId === socket\.id\)\);\n    \}\);/,
  "      socket.emit('userOrders', orders.filter(o => o.userId === socket.id));\n      socket.emit('balance', balances[socket.id] || 12480.50);\n    });"
);
// Wait, the emit in subscribe:
serverCode = serverCode.replace(
  /      socket\.emit\('userOrders', orders\.filter\(o => o\.userId === socket\.id\)\);\n    \}\);\n\n    socket\.on\('placeOrder'/,
  "      socket.emit('userOrders', orders.filter(o => o.userId === socket.id));\n      socket.emit('balance', balances[socket.id] || 12480.50);\n    });\n\n    socket.on('placeOrder'"
);

fs.writeFileSync('server.ts', serverCode);

let clientCode = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');
clientCode = clientCode.replace(/const MOCK_BALANCE = 12480.50;/, '');
clientCode = clientCode.replace(
  /  const \[userOrders, setUserOrders\] = useState<OpenOrder\[\]>\(\[\]\);/,
  '  const [userOrders, setUserOrders] = useState<OpenOrder[]>([]);\n  const [balance, setBalance] = useState(12480.50);'
);
clientCode = clientCode.replace(
  /    socket\.on\('userOrders', \(orders: any\) => setUserOrders\(orders\)\);/,
  "    socket.on('userOrders', (orders: any) => setUserOrders(orders));\n    socket.on('balance', (bal: number) => setBalance(bal));"
);
// replace MOCK_BALANCE with balance
clientCode = clientCode.replace(/MOCK_BALANCE/g, 'balance');

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', clientCode);
