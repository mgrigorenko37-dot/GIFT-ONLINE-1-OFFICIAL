import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

# Margin doesn't exist in executeTrade! We need to query it or pass it.
# executeTrade takes `client: PoolClient | any, order: Order, tradeId: string, executedQty: number, avgFillPrice: number, fee: number`
target = r'''    const currentBalanceDecimal = balRes\.rows\.length > 0 && balRes\.rows\[0\]\.available_balance != null
      \? new Decimal\(balRes\.rows\[0\]\.available_balance\) 
      : \(margin\.walletBalanceDec \|\| new Decimal\(margin\.walletBalance\)\);'''

replacement = '''    const currentBalanceDecimal = new Decimal(balRes.rows.length > 0 ? balRes.rows[0].available_balance : 0);
    const usedMarginStr = balRes.rows.length > 0 ? balRes.rows[0].locked_balance : 0;
    const usedMarginDec = new Decimal(usedMarginStr);'''

content = re.sub(target, replacement, content)

target2 = r'''(margin.usedMarginDec || new Decimal(margin.usedMargin))'''
replacement2 = '''usedMarginDec'''

content = content.replace(target2, replacement2)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
