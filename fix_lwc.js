const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

code = code.replace(
  /import \{ createChart, ColorType, CrosshairMode \} from 'lightweight-charts';/,
  "import { createChart, ColorType, CrosshairMode, CandlestickSeries } from 'lightweight-charts';"
);

code = code.replace(
  /const candlestickSeries = \(chart as any\)\.addCandlestickSeries\(\{/,
  'const candlestickSeries = chart.addSeries(CandlestickSeries, {'
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
