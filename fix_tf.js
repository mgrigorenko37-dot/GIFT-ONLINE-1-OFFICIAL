const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldGenerate = `    const generateData = () => {
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

const newGenerate = `    const generateData = () => {
      const data = [];
      let currentPrice = activeGift.floor * 0.9;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
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
      const startTime = (now.getTime() / 1000) - (60 * step);
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

if (code.includes(oldGenerate)) {
    code = code.replace(oldGenerate, newGenerate);
    console.log("Replaced generateData!");
} else {
    console.log("Could not find oldGenerate.");
}

const oldDeps = `    };
  }, [activeGift.id, activeGift.floor]);`;
  
const newDeps = `    };
  }, [activeGift.id, activeGift.floor, timeframe]);`;

if (code.includes(oldDeps)) {
    code = code.replace(oldDeps, newDeps);
    console.log("Replaced dependencies!");
} else {
    console.log("Could not find oldDeps.");
}

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
