const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

code = code.replace(
  /import \{ io, Socket \} from 'socket\.io-client';/,
  "import { io, Socket } from 'socket.io-client';"
);
// wait, if there is no exported member 'io', maybe it's `import io, { Socket } from 'socket.io-client';`
code = code.replace(
  /import \{ io, Socket \} from 'socket\.io-client';/,
  "import io, { Socket } from 'socket.io-client';"
);

code = code.replace(
  /socket\.on\('orderBook', \(book\) => setOrderBook\(book\)\);/,
  "socket.on('orderBook', (book: any) => setOrderBook(book));"
);
code = code.replace(
  /socket\.on\('recentTrades', \(trades\) => setRecentTrades\(trades\)\);/,
  "socket.on('recentTrades', (trades: any) => setRecentTrades(trades));"
);
code = code.replace(
  /socket\.on\('userOrders', \(orders\) => setUserOrders\(orders\)\);/,
  "socket.on('userOrders', (orders: any) => setUserOrders(orders));"
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
