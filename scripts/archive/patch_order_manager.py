import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

if "import Decimal" not in content:
    content = "import Decimal from 'decimal.js';\n" + content

content = re.sub(
    r'const requiredMargin = \(order\.qty \* \(order\.price \|\| 0\)\) / leverage;',
    r'''const requiredMarginDec = new Decimal(order.qty).mul(new Decimal(order.price || 0)).div(new Decimal(leverage));
        const requiredMargin = requiredMarginDec.toNumber();''',
    content
)

content = re.sub(
    r'const newLocked = margin\.usedMargin \+ requiredMargin;',
    r'''const newLockedDec = (margin.usedMarginDec || new Decimal(margin.usedMargin)).plus(requiredMarginDec);
        const newLocked = newLockedDec.toNumber();''',
    content
)

content = re.sub(
    r'\[newLocked, Date\.now\(\), order\.userId, order\.collateralCurrency\]',
    r'[newLockedDec.toString(), Date.now(), order.userId, order.collateralCurrency]',
    content
)

# 443 
content = re.sub(
    r'const newLocked = Math\.max\(0, updatedMargin\.usedMargin - marginFreed\);',
    r'''const marginFreedDec = new Decimal(marginFreed);
      const newLockedDec = Decimal.max(0, (updatedMargin.usedMarginDec || new Decimal(updatedMargin.usedMargin)).minus(marginFreedDec));
      const newLocked = newLockedDec.toNumber();''',
    content
)

content = re.sub(
    r'\[newLocked, Date\.now\(\), order\.userId, order\.collateralCurrency\]',
    r'[newLockedDec.toString(), Date.now(), order.userId, order.collateralCurrency]',
    content
)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
