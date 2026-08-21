import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r'const currentBalance = currentBalanceDec\?\.toNumber\(\) \|\| margin\.walletBalance;',
    r'const currentBalance = currentBalanceDec?.toNumber() || margin.walletBalance;\n    const currentBalanceDecimal = currentBalanceDec || new Decimal(margin.walletBalance);',
    content
)

content = re.sub(
    r'const newBalance = currentBalance - fee \+ currentTradeRealizedPnl;',
    r'''const feeDec = new Decimal(fee);
    const pnlDec = new Decimal(currentTradeRealizedPnl);
    const newBalanceDec = currentBalanceDecimal.minus(feeDec).plus(pnlDec);
    const newBalance = newBalanceDec.toNumber();''',
    content
)

content = re.sub(
    r'\[newBalance, margin\.usedMargin, newRealizedPnl, newTotalFees, Date\.now\(\), order\.userId, currency\]',
    r'[newBalanceDec.toString(), (margin.usedMarginDec || new Decimal(margin.usedMargin)).toString(), newRealizedPnl, newTotalFees, Date.now(), order.userId, currency]',
    content
)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
