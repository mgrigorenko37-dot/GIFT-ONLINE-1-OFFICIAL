const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');
code = code.replace(
  /import \{ io \} from 'socket\.io-client';/,
  "import { io } from 'socket.io-client';"
); // it is already this?
// Wait, maybe we should just use `import io from 'socket.io-client';`
code = code.replace(
  /import \{ io \} from 'socket\.io-client';/,
  "import { io } from 'socket.io-client';"
);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
