import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

# Replace scoping issue once and for all: define currentBalanceDecimal right before it's used
target = r'''    let currentRealizedPnl = balRes\.rows\.length > 0 \? Number\(balRes\.rows\[0\]\.realized_pnl\) : 0;
    let currentTotalFees = balRes\.rows\.length > 0 \? Number\(balRes\.rows\[0\]\.total_fees\) : 0;

    const feeDec = new Decimal\(fee\);
    const pnlDec = new Decimal\(currentTradeRealizedPnl\);
    const newBalanceDec = currentBalanceDecimal\.minus\(feeDec\)\.plus\(pnlDec\);'''

replacement = '''    let currentRealizedPnl = balRes.rows.length > 0 ? Number(balRes.rows[0].realized_pnl) : 0;
    let currentTotalFees = balRes.rows.length > 0 ? Number(balRes.rows[0].total_fees) : 0;

    const currentBalanceDecimal = new Decimal(balRes.rows.length > 0 ? balRes.rows[0].available_balance : margin.walletBalance);
    const feeDec = new Decimal(fee);
    const pnlDec = new Decimal(currentTradeRealizedPnl);
    const newBalanceDec = currentBalanceDecimal.minus(feeDec).plus(pnlDec);'''

content = re.sub(target, replacement, content)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)

