const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');
code = code.replace(
  /import \{ createChart, ColorType, CrosshairMode, CandlestickSeries \} from 'lightweight-charts';/,
  "import { createChart, ColorType, CrosshairMode, CandlestickSeries, UTCTimestamp } from 'lightweight-charts';"
);
code = code.replace(
  /time: startTime \+ i \* 3600,/,
  'time: (startTime + i * 3600) as UTCTimestamp,'
);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
