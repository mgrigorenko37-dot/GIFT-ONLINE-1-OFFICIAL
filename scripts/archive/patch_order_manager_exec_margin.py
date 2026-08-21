import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

# I replaced `(margin.usedMarginDec || new Decimal(margin.usedMargin))` with `usedMarginDec` in executeTrade.
# Let's check for any remaining `margin.` in executeTrade.

content = re.sub(r'\(margin\.usedMarginDec \|\| new Decimal\(margin\.usedMargin\)\)', 'usedMarginDec', content)
content = re.sub(r'margin\.usedMargin', 'usedMarginDec.toNumber()', content)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
