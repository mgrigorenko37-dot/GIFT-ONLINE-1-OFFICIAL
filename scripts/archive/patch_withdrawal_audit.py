import re

with open('server/withdrawalStateMachine.ts', 'r') as f:
    content = f.read()

target_release = r'''    // 4\. Release locked funds safely
    await client\.query\(
      `UPDATE te_balances 
       SET locked_balance = locked_balance - \$1, 
           available_balance = available_balance \+ \$1, 
           updated_at = \$2 
       WHERE user_id = \$3 AND currency = 'TON'`,
      \[withdrawal\.amount, now, withdrawal\.user_id\]
    \);'''

replacement_release = '''    // 4. Release locked funds safely
    const releaseRes = await client.query(
      `UPDATE te_balances 
       SET locked_balance = locked_balance - $1, 
           available_balance = available_balance + $1, 
           updated_at = $2 
       WHERE user_id = $3 AND currency = 'TON'
       RETURNING available_balance, locked_balance`,
      [withdrawal.amount, now, withdrawal.user_id]
    );

    const av = new Decimal(releaseRes.rows[0].available_balance);
    const loc = new Decimal(releaseRes.rows[0].locked_balance);
    const amt = new Decimal(withdrawal.amount);
    await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'WITHDRAWAL_RELEASE',
          withdrawal.user_id,
          withdrawalId,
          'TON',
          amt.toString(),
          av.minus(amt).toString(),
          av.toString(),
          loc.plus(amt).toString(),
          loc.toString(),
          JSON.stringify({ reason }),
          Date.now()
        ]
    );'''

content = re.sub(target_release, replacement_release, content)

target_lock = r'''    // 3\. Lock the balance for withdrawal \(Atomic decrement\)
    const lockRes = await client\.query\(
      `UPDATE te_balances 
       SET available_balance = available_balance - \$1,
           locked_balance = locked_balance \+ \$1,
           updated_at = \$2
       WHERE user_id = \$3 AND currency = 'TON' AND available_balance >= \$1
       RETURNING available_balance`,
      \[amount, now, userId\]
    \);'''

replacement_lock = '''    // 3. Lock the balance for withdrawal (Atomic decrement)
    const lockRes = await client.query(
      `UPDATE te_balances 
       SET available_balance = available_balance - $1,
           locked_balance = locked_balance + $1,
           updated_at = $2
       WHERE user_id = $3 AND currency = 'TON' AND available_balance >= $1
       RETURNING available_balance, locked_balance`,
      [amount, now, userId]
    );

    if (lockRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Insufficient funds for user ${userId} to withdraw ${amount} TON`);
    }

    const av = new Decimal(lockRes.rows[0].available_balance);
    const loc = new Decimal(lockRes.rows[0].locked_balance);
    const amt = new Decimal(amount);
    
    await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'WITHDRAWAL_LOCK',
          userId,
          withdrawalId,
          'TON',
          amt.toString(),
          av.plus(amt).toString(),
          av.toString(),
          loc.minus(amt).toString(),
          loc.toString(),
          JSON.stringify({ destination: address }),
          Date.now()
        ]
    );'''

content = re.sub(target_lock, replacement_lock, content)

target_deduct = r'''    // 5\. Permanently deduct locked funds \(fee is already part of amount\)
    await client\.query\(
      `UPDATE te_balances 
       SET locked_balance = locked_balance - \$1, 
           updated_at = \$2 
       WHERE user_id = \$3 AND currency = 'TON'`,
      \[withdrawal\.amount, now, withdrawal\.user_id\]
    \);'''

replacement_deduct = '''    // 5. Permanently deduct locked funds (fee is already part of amount)
    const deductRes = await client.query(
      `UPDATE te_balances 
       SET locked_balance = locked_balance - $1, 
           updated_at = $2 
       WHERE user_id = $3 AND currency = 'TON'
       RETURNING available_balance, locked_balance`,
      [withdrawal.amount, now, withdrawal.user_id]
    );

    const av = new Decimal(deductRes.rows[0].available_balance);
    const loc = new Decimal(deductRes.rows[0].locked_balance);
    const amt = new Decimal(withdrawal.amount);

    await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'WITHDRAWAL_DEDUCT',
          withdrawal.user_id,
          withdrawalId,
          'TON',
          amt.toString(),
          av.toString(),
          av.toString(),
          loc.plus(amt).toString(),
          loc.toString(),
          JSON.stringify({ txHash, workerId }),
          Date.now()
        ]
    );'''

content = re.sub(target_deduct, replacement_deduct, content)

with open('server/withdrawalStateMachine.ts', 'w') as f:
    if "import Decimal" not in content:
        content = "import Decimal from 'decimal.js';\n" + content
    f.write(content)

