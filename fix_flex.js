const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(
  /\.gx-chart-panel \{\n  min-height: 437px;\n\}/,
  '.gx-chart-panel {\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n}\n.gx-chart-container {\n  flex: 1;\n  min-height: 0;\n}'
);

// We need to also wrap the lightweight-chart in a div that handles flex properly
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');
tsx = tsx.replace(
  /<div\n\s+ref=\{chartContainerRef\}\n\s+className='gx-chart'\n\s+\/>/,
  "<div className='gx-chart-container' style={{ flex: 1, minHeight: 0, position: 'relative' }}><div ref={chartContainerRef} className='gx-chart' style={{ position: 'absolute', inset: 0 }} /></div>"
);

// We also need to fix order book so it takes full height properly
tsx = tsx.replace(
  /<div className='gx-panel gx-orderbook-panel' style=\{\{ flex: 1, minHeight: 300 \}\}>/,
  "<div className='gx-panel gx-orderbook-panel' style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>"
);

// Markets panel flex
tsx = tsx.replace(
  /<div className='gx-panel gx-markets-panel'>/,
  "<div className='gx-panel gx-markets-panel' style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>"
);
tsx = tsx.replace(
  /<div className='gx-market-list'>/,
  "<div className='gx-market-list' style={{ flex: 1, overflowY: 'auto' }}>"
);

// order panel flex
tsx = tsx.replace(
  /<div className='gx-panel gx-order-panel'>/,
  "<div className='gx-panel gx-order-panel' style={{ display: 'flex', flexDirection: 'column' }}>"
);

fs.writeFileSync('src/styles/site.css', css);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
