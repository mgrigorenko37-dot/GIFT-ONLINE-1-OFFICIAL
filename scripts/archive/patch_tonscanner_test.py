import re

with open('tests/integration/tonScanner.test.ts', 'r') as f:
    content = f.read()

target = """    const outboxRes = await pool.query(
      "SELECT * FROM te_outbox_events WHERE user_id = $1 AND event_type = 'depositProcessed'",
      [userId]
    );
    expect(outboxRes.rows.length).toBeGreaterThan(0);"""

replacement = """    const outboxRes = await pool.query(
      "SELECT * FROM te_outbox_events WHERE user_id = $1 AND event_type = 'depositProcessed'",
      [userId]
    );
    expect(outboxRes.rows.length).toBeGreaterThan(0);

    const auditRes = await pool.query(
      "SELECT * FROM te_financial_audits WHERE user_id = $1 AND event_type = 'TON_DEPOSIT'",
      [userId]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
    expect(Number(auditRes.rows[0].amount)).toBe(5.5);
    expect(auditRes.rows[0].reference_id).toBe('hash1');"""

content = content.replace(target, replacement)

with open('tests/integration/tonScanner.test.ts', 'w') as f:
    f.write(content)
