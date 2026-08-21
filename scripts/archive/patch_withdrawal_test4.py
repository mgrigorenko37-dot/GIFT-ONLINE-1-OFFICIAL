import re

with open('server/withdrawalStateMachine.test.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r"c\[0\]\.includes\('UPDATE te_balances'\)",
    r"c[0].includes('UPDATE te_balances') && c[0].includes('locked_balance = locked_balance - $1') && !c[0].includes('available_balance')",
    content
)

with open('server/withdrawalStateMachine.test.ts', 'w') as f:
    f.write(content)
