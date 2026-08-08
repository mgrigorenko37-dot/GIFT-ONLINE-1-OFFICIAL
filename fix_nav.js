const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

code = code.replace(
  "const [searchParams] = useSearchParams();",
  "const [searchParams, setSearchParams] = useSearchParams();"
);

code = code.replace(
  "navigate(`/market?gift=${gift.id}`);",
  "setSearchParams({ gift: gift.id });"
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
