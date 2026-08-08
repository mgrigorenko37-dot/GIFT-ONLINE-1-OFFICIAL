const fs = require('fs');
let code = fs.readFileSync('src/screens/Portfolio/PortfolioScreen.tsx', 'utf8');

code = code.replace(
  /const myGifts = \[[\s\S]*?\];/,
  ""
);

code = code.replace(
  "const PortfolioScreen: React.FC = () => {\n  const { gifts, loading } = useGifts();",
  "const PortfolioScreen: React.FC = () => {\n  const { gifts, loading } = useGifts();\n  const myGifts = [\n    { ...gifts[0], shares: 300, avgBuy: 118.4, pnl: +19.2 },\n    { ...gifts[3], shares: 750, avgBuy: 51.2, pnl: +15.0 },\n    { ...gifts[1], shares: 120, avgBuy: 90.0, pnl: -4.2 },\n    { ...gifts[5], shares: 50, avgBuy: 610.0, pnl: +4.9 },\n  ].filter(g => g.id);"
);

fs.writeFileSync('src/screens/Portfolio/PortfolioScreen.tsx', code);
