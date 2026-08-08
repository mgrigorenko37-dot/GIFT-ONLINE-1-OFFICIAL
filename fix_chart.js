const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// I'll replace the existing chart useEffect with two separate ones.
// I need to be careful with the exact string replacement.
const oldChartCodeStart = `  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {`;

const oldChartCodeEnd = `    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
      chart.remove();
    };
  }, [activeGift?.id, activeGift?.floor, timeframe]);`;

const oldChartCode = code.substring(
  code.indexOf(oldChartCodeStart),
  code.indexOf(oldChartCodeEnd) + oldChartCodeEnd.length
);

const newChartCode = `  // 1. Initialize Chart (run once)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#625d70',
      },
      grid: {
        vertLines: { color: '#2a2840' },
        horzLines: { color: '#2a2840' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: '#8b76ff', style: 3 },
        horzLine: { width: 1, color: '#8b76ff', style: 3 },
      },
      rightPriceScale: { borderColor: '#2a2840' },
      timeScale: { borderColor: '#2a2840', timeVisible: true, secondsVisible: false },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    seriesRef.current = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(() => handleResize());
    ro.observe(chartContainerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 2. Update Chart Data
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    const generateData = () => {
      const data = [];
      let currentPrice = (activeGift?.floor || 0) * 0.9;
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
      last.close = (activeGift?.floor || 0);
      last.high = Math.max(last.high, (activeGift?.floor || 0));
      last.low = Math.min(last.low, (activeGift?.floor || 0));

      latestCandleRef.current = last;
      return data;
    };

    seriesRef.current.setData(generateData());
    chartRef.current.timeScale().fitContent();
  }, [activeGift?.id, activeGift?.floor, timeframe]);`;

if (code.includes(oldChartCodeStart)) {
  code = code.replace(oldChartCode, newChartCode);
  fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
  console.log("Success");
} else {
  console.log("Failed to find old code block.");
}
