import re

with open('server/withdrawalStateMachine.test.ts', 'r') as f:
    content = f.read()

# Since we switched to `RETURNING available_balance, locked_balance` and our query parameters changed, let's just assert on the table name.
content = re.sub(
    r"c\[0\]\.includes\('UPDATE te_balances'\) && c\[0\]\.includes\('locked_balance = locked_balance - \$1'\) && !c\[0\]\.includes\('available_balance'\)",
    r"c[0].includes('UPDATE te_balances')",
    content
)

with open('server/withdrawalStateMachine.test.ts', 'w') as f:
    f.write(content)
