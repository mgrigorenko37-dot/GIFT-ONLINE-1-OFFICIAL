const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');
content = content.replace(
  'onClick={() => submitOrder()} disabled={isSubmitting}',
  'onClick={() => submitOrder(true)} disabled={isSubmitting}'
);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
