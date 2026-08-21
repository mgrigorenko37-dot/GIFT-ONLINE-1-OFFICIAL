import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

# Fix currentBalanceDecimal scoping issue
target_fix = r'''    const currentBalance = currentBalanceDec\?\.toNumber\(\) \|\| margin\.walletBalance;
    const currentBalanceDecimal = currentBalanceDec \|\| new Decimal\(margin\.walletBalance\);'''

replacement_fix = '''    const currentBalanceDecimal = (margin.walletBalanceDec || new Decimal(margin.walletBalance));
    const currentBalance = currentBalanceDecimal.toNumber();'''

content = re.sub(target_fix, replacement_fix, content)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
