const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldLogic = `  const submitOrder = (isClose: boolean = false) => {
    if (isSubmitting) return;
    const numericAmount = Number(amount);
    const numericPrice = orderType === 'Market' ? 0 : Number(price);
    // Margin calculations
  const usedMargin = positions.filter(p => p.status === 'Open').reduce((acc, p) => acc + (p.qty * p.avgEntryPrice), 0);
  const totalUnrealizedPnl = positions.filter(p => p.status === 'Open').reduce((acc, p) => {
    const mark = p.instrumentKey === activeGift?.id ? curPrice : (p.markPrice || p.avgEntryPrice);
    const pnlMultiplier = p.side === 'Long' ? 1 : -1;
    return acc + ((mark - p.avgEntryPrice) * p.qty * pnlMultiplier);
  }, 0);
  const equity = balance + totalUnrealizedPnl;
  const availableBalance = equity - usedMargin;

  const activePosition = positions.find(p => p.instrumentKey === (activeGift?.id || '') && p.status === 'Open');`;

const newLogic = `  // Margin calculations
  const usedMargin = positions.filter(p => p.status === 'Open').reduce((acc, p) => acc + (p.qty * p.avgEntryPrice), 0);
  const totalUnrealizedPnl = positions.filter(p => p.status === 'Open').reduce((acc, p) => {
    const mark = p.instrumentKey === activeGift?.id ? curPrice : (p.markPrice || p.avgEntryPrice);
    const pnlMultiplier = p.side === 'Long' ? 1 : -1;
    return acc + ((mark - p.avgEntryPrice) * p.qty * pnlMultiplier);
  }, 0);
  const equity = balance + totalUnrealizedPnl;
  const availableBalance = equity - usedMargin;

  const activePosition = positions.find(p => p.instrumentKey === (activeGift?.id || '') && p.status === 'Open');

  const submitOrder = (isClose: boolean = false) => {
    if (isSubmitting) return;
    const numericAmount = Number(amount);
    const numericPrice = orderType === 'Market' ? 0 : Number(price);`;

content = content.replace(oldLogic, newLogic);
fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
