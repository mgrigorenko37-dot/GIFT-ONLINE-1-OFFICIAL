const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

code = code.replace(
  'const activeGift = useMemo(() => gifts.find((g) => g.id === giftId) || gifts[0], [giftId]);',
  'const activeGift = useMemo(() => gifts.find((g) => g.id === giftId) || gifts[0], [giftId, gifts]);'
);

code = code.replace(
  '  }, [activeGift.id, activeGift.floor, timeframe]);\n\n  const chartContainerRef = useRef<HTMLDivElement>(null);',
  '  }, [activeGift?.id]);\n\n  const chartContainerRef = useRef<HTMLDivElement>(null);'
);

code = code.replace(
  "    return () => {\n      window.removeEventListener('resize', handleResize);\n      ro.disconnect();\n      chart.remove();\n    };\n  }, [activeGift.floor, timeframe]);",
  "    return () => {\n      window.removeEventListener('resize', handleResize);\n      ro.disconnect();\n      chart.remove();\n    };\n  }, [activeGift?.id, activeGift?.floor, timeframe]);"
);

// We need to be careful with activeGift possibly being undefined if gifts is empty.
code = code.replace(/activeGift\.floor/g, '(activeGift?.floor || 0)');
code = code.replace(/activeGift\.id/g, "(activeGift?.id || '')");
code = code.replace(/activeGift\.name/g, "(activeGift?.name || '')");
code = code.replace(/activeGift\.change/g, '(activeGift?.change || 0)');
code = code.replace(/activeGift\.volume/g, "(activeGift?.volume || '')");

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
