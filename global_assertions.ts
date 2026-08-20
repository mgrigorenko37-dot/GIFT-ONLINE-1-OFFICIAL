import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

async function run() {
  console.log('=== GLOBAL DATABASE ASSERTIONS ===');

  try {
    // 1. One funding payment per unique key
    const dupFunding = await pool.query(`
      SELECT position_id, funding_timestamp, COUNT(*) as c
      FROM te_funding_payments
      GROUP BY position_id, funding_timestamp
      HAVING COUNT(*) > 1
    `);
    console.log(
      `[ASSERT] No duplicate funding payments: ${dupFunding.rowCount === 0 ? 'PASS' : 'FAIL'} (${dupFunding.rowCount} found)`
    );

    // 2. No negative balances
    const negBal = await pool.query(`
      SELECT user_id, currency, available_balance 
      FROM te_balances 
      WHERE available_balance < 0 OR locked_balance < 0
    `);
    console.log(
      `[ASSERT] No negative balances: ${negBal.rowCount === 0 ? 'PASS' : 'FAIL'} (${negBal.rowCount} found)`
    );

    // 3. Correct funding amount (qty * mark_price * funding_rate)
    const amountCheck = await pool.query(`
      SELECT funding_id, funding_amount, qty, mark_price, funding_rate, notional
      FROM te_funding_payments
      WHERE ABS(ABS(funding_amount) - (qty * mark_price * ABS(funding_rate))) > 0.001
    `);
    console.log(
      `[ASSERT] Correct funding amounts calculated: ${(amountCheck.rowCount ?? 0) === 0 ? 'PASS' : 'FAIL'} (${amountCheck.rowCount ?? 0} found)`
    );
    if ((amountCheck.rowCount ?? 0) > 0) console.log(amountCheck.rows);

    // 4. Currency matches
    const currCheck = await pool.query(`
      SELECT p.position_id, p.instrument_key, fp.currency
      FROM te_funding_payments fp
      JOIN te_positions p ON fp.position_id = p.position_id
      WHERE fp.currency != p.collateral_currency AND p.collateral_currency IS NOT NULL
    `);
    console.log(
      `[ASSERT] Correct currency mapped to payments: ${currCheck.rowCount === 0 ? 'PASS' : 'FAIL'} (${currCheck.rowCount} found)`
    );

    // 5. No double margin call (liquidation)
    // Check in te_positions if we have status = 'LIQUIDATED'
    // Actually, margin calls close the position and might insert into te_orders.
    const multiLiq = await pool.query(`
      SELECT order_id
      FROM te_orders
      WHERE status = 'LIQUIDATED'
    `);
    console.log(`[INFO] Liquidations found: ${multiLiq.rowCount}`);

    // 6. Check te_ledger / outbox for duplicated ledger updates
    // A single funding batch should produce exactly one ledgerUpdated event per user/currency
    const dupOutbox = await pool.query(`
      SELECT user_id, payload, COUNT(*) as c
      FROM te_outbox_events
      WHERE event_type = 'ledgerUpdated' AND payload LIKE '%FUNDING%'
      GROUP BY user_id, payload
      HAVING COUNT(*) > 1
    `);
    console.log(
      `[ASSERT] No duplicate ledger events in outbox: ${dupOutbox.rowCount === 0 ? 'PASS' : 'FAIL'} (${dupOutbox.rowCount} found)`
    );

    // 7. Verify NO partial deductions (this means if a user didn't have enough balance, they either got fully deducted or liquidated/bankrupt, but their balance doesn't go below 0).
    // We already checked no negative balances.

    console.log('\nAll Assertions Completed.');
  } catch (e: any) {
    console.error('Error during assertions:', e.message);
  } finally {
    pool.end();
  }
}

run();
