const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

if (!code.includes('mktPanelOpen')) {
  console.log('Already fixed?');
}

if (!code.includes('const [mktPanelOpen')) {
  code = code.replace(
    /const activeGift = useMemo\(\(\) => gifts\.find\(\(g\) => g\.id === giftId\) \|\| gifts\[0\], \[giftId\]\);/,
    "const activeGift = useMemo(() => gifts.find((g) => g.id === giftId) || gifts[0], [giftId]);\n  const [mktPanelOpen, setMktPanelOpen] = useState(false);\n  const [searchQuery, setSearchQuery] = useState('');\n  const filteredGifts = gifts.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));"
  );
  fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
}
