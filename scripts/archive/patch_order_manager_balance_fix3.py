import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

# Make sure we use balRes.rows[0].available_balance properly with Decimal.
target = r'''    let currentRealizedPnl = balRes\.rows\.length > 0 \? Number\(balRes\.rows\[0\]\.realized_pnl\) : 0;
    let currentTotalFees = balRes\.rows\.length > 0 \? Number\(balRes\.rows\[0\]\.total_fees\) : 0;

    const currentBalanceDecimal = new Decimal\(balRes\.rows\.length > 0 \? balRes\.rows\[0\]\.available_balance : margin\.walletBalance\);'''

replacement = '''    let currentRealizedPnl = balRes.rows.length > 0 ? Number(balRes.rows[0].realized_pnl) : 0;
    let currentTotalFees = balRes.rows.length > 0 ? Number(balRes.rows[0].total_fees) : 0;

    const currentBalanceDecimal = balRes.rows.length > 0 && balRes.rows[0].available_balance != null
      ? new Decimal(balRes.rows[0].available_balance) 
      : (margin.walletBalanceDec || new Decimal(margin.walletBalance));'''

content = re.sub(target, replacement, content)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
