const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');
code = code.replace(
  /import io, \{ Socket \} from 'socket\.io-client';/,
  "import { io } from 'socket.io-client';"
);
code = code.replace(
  /const socketRef = useRef<Socket \| null>\(null\);/,
  'const socketRef = useRef<any>(null);'
);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
