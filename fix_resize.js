const fs = require('fs');
let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

tsx = tsx.replace(
  /const handleResize = \(\) => \{\n\s+if \(chartContainerRef\.current\) \{\n\s+chart\.applyOptions\(\{ width: chartContainerRef\.current\.clientWidth \}\);\n\s+\}\n\s+\};\n\s+window\.addEventListener\('resize', handleResize\);\n\n\s+return \(\) => \{\n\s+window\.removeEventListener\('resize', handleResize\);\n\s+chart\.remove\(\);\n\s+\};/,
  `const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
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
    };`
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
