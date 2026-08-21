import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgresTradingEngine } from '../../server/tradingEngine';
import { Pool } from 'pg';
import { initDbSchema } from '../../server/dbSchema';
import { getPostgresConfig } from '../../server/dbConfig';
import Decimal from 'decimal.js';

describe('PostgresTradingEngine Financial Invariants & Concurrency Audit', () => {
  let pool: Pool;
  let engine: PostgresTradingEngine;

  beforeAll(async () => {
    const dbConf = getPostgresConfig();
    if (dbConf.config) {
      pool = new Pool(dbConf.config);
    } else {
      pool = new Pool({ connectionString: 'postgres://node@localhost:5432/gx_exchange_test' });
    }

    try {
      await pool.query('DROP TABLE IF EXISTS te_orders CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_executions CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_positions CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_balances CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_outbox_events CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_trades CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_financial_audits CASCADE');
    } catch (e: any) {
      // Ignore cleanup error
    }

    await initDbSchema(pool);
    engine = new PostgresTradingEngine(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM te_outbox_events');
    await pool.query('DELETE FROM te_position_snapshots');
    await pool.query('DELETE FROM te_trades');
    await pool.query('DELETE FROM te_executions');
    await pool.query('DELETE FROM te_orders');
    await pool.query('DELETE FROM te_positions');
    await pool.query('DELETE FROM te_balances');
    await pool.query('DELETE FROM te_financial_audits');

    // Seed balances with sufficient buffer for fees & margin
    await pool.query(
      "INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, created_at, updated_at) VALUES ($1, 'TON', $2, 0, 0, 0, $3, $3)",
      ['inv_user1', '10000', Date.now()]
    );
    await pool.query(
      "INSERT INTO te_balances (user_id, currency, available_balance, locked_balance, realized_pnl, total_fees, created_at, updated_at) VALUES ($1, 'TON', $2, 0, 0, 0, $3, $3)",
      ['inv_user2', '10000', Date.now()]
    );
  });

  it('Invariant 1: Order quantity conservation (executedQty + remainingQty === qty)', async () => {
    const order = await engine.placeOrder({
      userId: 'inv_user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 100,
      price: 10,
      reduceOnly: false,
    });

    expect(order.executedQty + order.remainingQty).toBe(100);

    // Partial fill 30
    await engine.executeTrade(order.orderId, 30, 10);
    let updatedOrder = await engine.getOrder(order.orderId);
    expect(updatedOrder!.executedQty).toBe(30);
    expect(updatedOrder!.remainingQty).toBe(70);
    expect(updatedOrder!.executedQty + updatedOrder!.remainingQty).toBe(100);

    // Partial fill 70
    await engine.executeTrade(order.orderId, 70, 10);
    updatedOrder = await engine.getOrder(order.orderId);
    expect(updatedOrder!.executedQty).toBe(100);
    expect(updatedOrder!.remainingQty).toBe(0);
    expect(updatedOrder!.status).toBe('Filled');
  });

  it('Invariant 2: Balance and fee accounting atomicity (Delta Balance === Realized PnL - Fee)', async () => {
    // Open Long position for user 1
    const buyOrder = await engine.placeOrder({
      userId: 'inv_user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });
    const fillPrice = 100;
    const qty = 10;
    const expectedFee = qty * fillPrice * 0.0025; // 2.5

    const balBefore = await engine.getBalance('inv_user1', 'TON');
    await engine.executeTrade(buyOrder.orderId, qty, fillPrice);
    const balAfter = await engine.getBalance('inv_user1', 'TON');

    const expectedBal = new Decimal(balBefore).minus(new Decimal(expectedFee)).toNumber();
    expect(balAfter).toBeCloseTo(expectedBal, 4);

    // Verify outbox events were created
    const outboxRes = await pool.query(
      "SELECT * FROM te_outbox_events WHERE user_id = 'inv_user1' ORDER BY id ASC"
    );
    expect(outboxRes.rows.length).toBeGreaterThan(0);
    const eventTypes = outboxRes.rows.map((r) => r.event_type);
    expect(eventTypes).toContain('tradeExecuted');
    expect(eventTypes).toContain('orderUpdated');
    expect(eventTypes).toContain('positionUpdated');
    expect(eventTypes).toContain('balanceUpdated');
  });

  it('Invariant 3: Idempotent trade execution (Duplicate execution_id or external_id is a no-op)', async () => {
    const buyOrder = await engine.placeOrder({
      userId: 'inv_user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 50,
      reduceOnly: false,
    });

    const customExecId = 'exec_unique_123';
    const trade1 = await engine.executeTrade(buyOrder.orderId, 10, 50, customExecId);
    expect(trade1).not.toBeNull();

    // Repeat same executionId
    const trade2 = await engine.executeTrade(buyOrder.orderId, 10, 50, customExecId);
    expect(trade2).toBeNull(); // Deduplicated cleanly

    // Verify order remainingQty is 0 and not negative
    const finalOrder = await engine.getOrder(buyOrder.orderId);
    expect(finalOrder!.executedQty).toBe(10);
    expect(finalOrder!.remainingQty).toBe(0);
  });

  it('Invariant 4: Concurrent order executions do not produce over-filling or negative position', async () => {
    const buyOrder = await engine.placeOrder({
      userId: 'inv_user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 20,
      reduceOnly: false,
    });

    // Fire 5 parallel trade executions of 5 qty each on a 10 qty order
    const executionPromises = Array.from({ length: 5 }).map((_, idx) =>
      engine.executeTrade(buyOrder.orderId, 5, 20, `exec_concurrent_${idx}`)
    );

    await Promise.all(executionPromises);

    const finalOrder = await engine.getOrder(buyOrder.orderId);
    expect(finalOrder!.executedQty).toBe(10);
    expect(finalOrder!.remainingQty).toBe(0);

    const tradesRes = await pool.query('SELECT * FROM te_trades WHERE order_id = $1', [
      buyOrder.orderId,
    ]);
    const totalTradedQty = tradesRes.rows.reduce((sum, r) => sum + Number(r.qty), 0);
    expect(totalTradedQty).toBe(10);
  });

  it('Invariant 5: Liquidation under severe price drop triggers full closure, fee calculation, and audit logging', async () => {
    // Seed user balance to 100.25 TON
    await pool.query(
      "UPDATE te_balances SET available_balance = '100.25' WHERE user_id = 'inv_user1'"
    );

    const buyOrder = await engine.placeOrder({
      userId: 'inv_user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 10,
      reduceOnly: false,
    });
    const trade = await engine.executeTrade(buyOrder.orderId, 10, 10);
    expect(trade).not.toBeNull();

    // Deduct 0.98 from balance so walletBalance becomes 99.02 (after 0.25 fee = 99.02)
    await pool.query(
      "UPDATE te_balances SET available_balance = '99.02' WHERE user_id = 'inv_user1'"
    );

    // Update mark price to 0.1: unrealizedPnl = (0.1 - 10)*10 = -99. Equity = 99.02 - 99 = 0.02 <= maintenanceMargin (0.05)
    await engine.updateMarkPrice('TON', 0.1);

    const positions = await engine.getAllPositions('inv_user1');
    expect(positions.length).toBeGreaterThan(0);
    expect(positions[0].status).toBe('Liquidated');
    expect(positions[0].qty).toBe(0);

    // Verify financial audit record
    const auditRes = await pool.query(
      "SELECT * FROM te_financial_audits WHERE user_id = 'inv_user1' AND event_type = 'LIQUIDATION'"
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
    expect(auditRes.rows[0].currency).toBe('TON');

    // Verify outbox event for liquidation
    const outboxRes = await pool.query(
      "SELECT * FROM te_outbox_events WHERE user_id = 'inv_user1' AND event_type = 'marginCall'"
    );
    expect(outboxRes.rows.length).toBeGreaterThan(0);
  });

  it('Invariant 6: Total system assets conservation across all transactions', async () => {
    const bal1Start = await engine.getBalance('inv_user1', 'TON');
    const bal2Start = await engine.getBalance('inv_user2', 'TON');
    const systemStartTotal = bal1Start + bal2Start;

    // User 1 buys, user 2 sells
    const o1 = await engine.placeOrder({
      userId: 'inv_user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 10,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 10);

    const bal1Current = await engine.getBalance('inv_user1', 'TON');
    const bal2Current = await engine.getBalance('inv_user2', 'TON');

    const totalFeesRes = await pool.query('SELECT SUM(total_fees) as fees FROM te_balances');
    const totalFees = Number(totalFeesRes.rows[0].fees || 0);

    // Current balances + total paid fees === systemStartTotal
    const systemCurrentTotal = bal1Current + bal2Current + totalFees;
    expect(systemCurrentTotal).toBeCloseTo(systemStartTotal, 4);
  });
});
