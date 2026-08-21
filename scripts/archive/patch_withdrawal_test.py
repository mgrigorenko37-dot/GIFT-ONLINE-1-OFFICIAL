import re

with open('server/withdrawalStateMachine.test.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r"if \(c\[0\] === 'UPDATE te_balances.*?'\)",
    r"if (c[0].startsWith('UPDATE te_balances'))",
    content
)

content = re.sub(
    r"&& c\[0\]\.includes\('locked_balance = \$1'\)",
    r"&& c[0].includes('locked_balance = locked_balance - $1')",
    content
)
content = re.sub(
    r"&& c\[0\]\.includes\('available_balance = \$1'\)",
    r"&& c[0].includes('available_balance = available_balance + $1')",
    content
)

with open('server/withdrawalStateMachine.test.ts', 'w') as f:
    f.write(content)

