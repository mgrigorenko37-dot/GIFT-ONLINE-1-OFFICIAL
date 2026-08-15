const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// 1. Add state
const stateToInsert = `  const [timeframe, setTimeframe] = useState('4h');`;
if (!code.includes(stateToInsert)) {
  code = code.replace(
    /const \[searchQuery, setSearchQuery\] = useState\(''\);/,
    `const [searchQuery, setSearchQuery] = useState('');\n${stateToInsert}`
  );
}

// 2. Modify useEffect
const oldUseEffectBegin = `  useEffect(() => {
    if (!chartContainerRef.current) return;`;

const newUseEffectBegin = `  useEffect(() => {
    if (!chartContainerRef.current) return;`;

const oldGenerateData = `    const generateData = () => {
      const data = [];
      let currentPrice = activeGift.floor * 0.9;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const startTime = now.getTime() / 1000;
      for (let i = 0; i < 60; i++) {
        const open = currentPrice;
        const close = open + (Math.random() - 0.45) * 5;
        const high = Math.max(open, close) + Math.random() * 2;
        const low = Math.min(open, close) - Math.random() * 2;
        data.push({
          time: (startTime + i * 3600) as UTCTimestamp,
          open,
          high,
          low,
          close,
        });
        currentPrice = close;
      }
      const last = data[data.length - 1];
      last.close = activeGift.floor;
      last.high = Math.max(last.high, activeGift.floor);
      last.low = Math.min(last.low, activeGift.floor);
      latestCandleRef.current = last;
      return data;
    };`;

const newGenerateData = `    const generateData = () => {
      const data = [];
      let currentPrice = activeGift.floor * 0.9;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      let startTime = now.getTime() / 1000;
      
      let step = 3600;
      if (timeframe === '1s') step = 1;
      else if (timeframe === '1m') step = 60;
      else if (timeframe === '5m') step = 300;
      else if (timeframe === '15m') step = 900;
      else if (timeframe === '30m') step = 1800;
      else if (timeframe === '1h') step = 3600;
      else if (timeframe === '4h') step = 14400;
      else if (timeframe === '1d') step = 86400;
      else if (timeframe === '1w') step = 604800;
      else if (timeframe === '1M') step = 2592000;

      // Adjust start time to generate enough data based on step
      startTime = (now.getTime() / 1000) - (60 * step);

      for (let i = 0; i < 60; i++) {
        const open = currentPrice;
        const close = open + (Math.random() - 0.45) * 5;
        const high = Math.max(open, close) + Math.random() * 2;
        const low = Math.min(open, close) - Math.random() * 2;
        data.push({
          time: (startTime + i * step) as UTCTimestamp,
          open,
          high,
          low,
          close,
        });
        currentPrice = close;
      }
      const last = data[data.length - 1];
      last.close = activeGift.floor;
      last.high = Math.max(last.high, activeGift.floor);
      last.low = Math.min(last.low, activeGift.floor);
      latestCandleRef.current = last;
      return data;
    };`;

code = code.replace(oldGenerateData, newGenerateData);

// Update dependency array for chart useEffect
code = code.replace(
  /    };\n  }, \[activeGift\.floor\]\);/,
  `    };\n  }, [activeGift.floor, timeframe]);`
);

// 3. Update HTML
const oldTfRow = `<div className="chart-toolbar" id="tfRow">
              <button className="tf-btn">15м</button>
              <button className="tf-btn">1ч</button>
              <button className="tf-btn active">4ч</button>
              <button className="tf-btn">1д</button>
              <button className="tf-btn">1н</button>
            </div>`;

const newTfRow = `<div className="chart-toolbar" id="tfRow">
              {['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'].map((tf) => (
                <button
                  key={tf}
                  className={\`tf-btn \${timeframe === tf ? 'active' : ''}\`}
                  onClick={() => setTimeframe(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>`;

code = code.replace(oldTfRow, newTfRow);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
