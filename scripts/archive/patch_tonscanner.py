import re

with open('server/tonScanner.ts', 'r') as f:
    content = f.read()

target = """      // 4. Update user balance atomically
      await client.query(
        `INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at)
          VALUES ($1, 'TON', $2, $3, $3)
          ON CONFLICT (user_id, currency)
          DO UPDATE SET
            available_balance = te_balances.available_balance + $2,
            updated_at = $3`,
        [userId, amount, Date.now()]
      );"""

replacement = """      // 4. Update user balance atomically
      const balanceRes = await client.query(
        `INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, updated_at, created_at)
          VALUES ($1, 'TON', $2, 0, $3, $3)
          ON CONFLICT (user_id, currency)
          DO UPDATE SET
            available_balance = te_balances.available_balance + $2,
            updated_at = $3
          RETURNING available_balance, locked_balance`,
        [userId, amount, Date.now()]
      );

      const newAvail = balanceRes.rows[0].available_balance;
      const newLocked = balanceRes.rows[0].locked_balance;
      const oldAvail = new Decimal(newAvail).minus(new Decimal(amount)).toString();

      // 4.5. Insert Financial Audit
      await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'TON_DEPOSIT',
          userId,
          hash,
          'TON',
          amount,
          oldAvail,
          newAvail,
          newLocked,
          newLocked,
          JSON.stringify({ senderAddress: senderRaw }),
          Date.now()
        ]
      );"""

# The space before VALUES might be different, let's use regex
content = re.sub(
    r'      // 4\. Update user balance atomically.*?      \);', 
    replacement, 
    content, 
    flags=re.DOTALL
)

with open('server/tonScanner.ts', 'w') as f:
    f.write(content)

