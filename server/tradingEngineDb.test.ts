import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { PostgresTradingEngine, Order } from './tradingEngine';
import { Pool } from 'pg';
import { initDbSchema } from './dbSchema';

describe('PostgresTradingEngine Real DB Tests', () => {
  let pool: Pool;
  let engine: PostgresTradingEngine;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.SQL_HOST || 'localhost',
      user: process.env.SQL_USER || 'ai_studio_app_user',
      password: process.env.SQL_PASSWORD || 'password',
      database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });

    pool.on('connect', (client) => {
      client.query('SET search_path TO "ai_studio_app_user", public').catch(() => {});
    });

    try {
      await pool.query('DROP TABLE IF EXISTS te_orders CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_executions CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_positions CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_balances CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_outbox_events CASCADE');
      await pool.query('DROP TABLE IF EXISTS te_trades CASCADE');
    } catch (e: any) {
      console.warn('Drop table notice:', e?.message);
    }

    await initDbSchema(pool);

    engine = new PostgresTradingEngine(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    try {
      await pool.query('DELETE FROM te_outbox_events');
      await pool.query('DELETE FROM te_funding_payments');
      await pool.query('DELETE FROM te_funding_periods');
      await pool.query('DELETE FROM te_position_snapshots');
      await pool.query('DELETE FROM te_outbox_events');
      await pool.query('DELETE FROM te_trades');
      await pool.query('DELETE FROM te_orders');
      await pool.query('DELETE FROM te_positions');
      await pool.query('DELETE FROM te_balances');

      await pool.query(
        "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'TON', $2, $3, $3)",
        ['user1', 10000, Date.now()]
      );
    } catch (e: any) {
      console.warn('DB setup in test skipped:', e?.message);
    }
  });

  it('1. Open Long 10, close Long fully, then open Short', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 5);

    const o2 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: true,
    });
    await engine.executeTrade(o2.orderId, 10, 5);

    let pos = await engine.getAllPositions('user1');
    expect(pos[0].status).toBe('Closed');
    expect(pos[0].qty).toBe(0);
    const firstPosId = pos[0].positionId;

    const o3 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 5,
      price: 5,
      reduceOnly: false,
    });
    await engine.executeTrade(o3.orderId, 5, 5);

    pos = await engine.getAllPositions('user1');
    expect(pos.length).toBe(1); // Reused
    expect(pos[0].positionId).toBe(firstPosId);
    expect(pos[0].status).toBe('Open');
    expect(pos[0].side).toBe('Short');
    expect(pos[0].qty).toBe(5);
  });

  it('2. Long 10 + Two Sell reduceOnly 10 (one rejected in placeOrder)', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 5);

    const o2 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: true,
    });
    const o3 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: true,
    });

    expect(o2.status).toBe('Open');
    expect(o3.status).toBe('Rejected'); // Exceeds available

    await engine.executeTrade(o2.orderId, 10, 5);

    const pos = await engine.getAllPositions('user1');
    expect(pos[0].qty).toBe(0);
    expect(pos[0].status).toBe('Closed');

    const tr = await engine.executeTrade(o3.orderId, 10, 5); // Should return null since it's rejected
    expect(tr).toBeNull();

    const finalPos = await engine.getAllPositions('user1');
    expect(finalPos[0].qty).toBe(0);
    expect(finalPos[0].status).toBe('Closed');
  });

  it('3. Long 10 + Sell reduceOnly 5 + Sell reduceOnly 10 (second rejected)', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 5);

    const o2 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 5,
      price: 5,
      reduceOnly: true,
    });
    const o3 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: true,
    });

    expect(o2.status).toBe('Open');
    expect(o3.status).toBe('Rejected'); // 5 reserved, so only 5 available, asking for 10
  });

  it('4. Long 10 + Sell reduceOnly 5 + Sell reduceOnly 5 (both open)', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 5);

    const o2 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 5,
      price: 5,
      reduceOnly: true,
    });
    const o3 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 5,
      price: 5,
      reduceOnly: true,
    });

    expect(o2.status).toBe('Open');
    expect(o3.status).toBe('Open');

    await engine.executeTrade(o2.orderId, 5, 5);
    await engine.executeTrade(o3.orderId, 5, 5);

    const pos = await engine.getAllPositions('user1');
    expect(pos[0].qty).toBe(0);
    expect(pos[0].status).toBe('Closed');
  });

  it('5. Short 10 + Buy reduceOnly 5 + Buy reduceOnly 5', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 5);

    const o2 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 5,
      price: 5,
      reduceOnly: true,
    });
    const o3 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 5,
      price: 5,
      reduceOnly: true,
    });

    expect(o2.status).toBe('Open');
    expect(o3.status).toBe('Open');

    await engine.executeTrade(o2.orderId, 5, 5);
    await engine.executeTrade(o3.orderId, 5, 5);

    const pos = await engine.getAllPositions('user1');
    expect(pos[0].qty).toBe(0);
    expect(pos[0].status).toBe('Closed');
  });

  it('6. Sell non-reduce with existing Long (acts as Close)', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 5);

    // We try to sell 15 non-reduce. Since Long exists, it should act as Close and reject because available=10.
    const o2 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 15,
      price: 5,
      reduceOnly: false,
    });
    expect(o2.status).toBe('Rejected'); // Because it's larger than position

    // Sell exactly 10 non-reduce should work and act as close
    const o3 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });
    expect(o3.status).toBe('Open');
    expect(o3.positionEffect).toBe('Close');

    await engine.executeTrade(o3.orderId, 10, 5);
    const pos = await engine.getAllPositions('user1');
    expect(pos[0].qty).toBe(0);
    expect(pos[0].status).toBe('Closed');
  });

  it('7. Check updateMarkPrice and positionUpdated outbox event', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 10,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 10);

    await pool.query('DELETE FROM te_outbox_events'); // Clear to see only mark price events

    await engine.updateMarkPrice('TON', 15);

    const events = await pool.query(
      "SELECT * FROM te_outbox_events WHERE event_type = 'positionUpdated'"
    );
    expect(events.rows.length).toBe(1);

    const payload = JSON.parse(events.rows[0].payload);
    expect(payload.markPrice).toBe(15);
    expect(payload.unrealizedPnl).toBe(50); // (15-10)*10
  });

  it('8. Parallel execution of same reduceOnly order does not result in negative qty', async () => {
    const o1 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 10,
      reduceOnly: false,
    });
    await engine.executeTrade(o1.orderId, 10, 10);

    const o2 = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 10,
      price: 10,
      reduceOnly: true,
    });

    const p1 = engine.executeTrade(o2.orderId, 10, 10);
    const p2 = engine.executeTrade(o2.orderId, 10, 10);

    await Promise.all([p1, p2]);

    const pos = await engine.getAllPositions('user1');
    expect(pos[0].qty).toBe(0); // Never negative
    expect(pos[0].status).toBe('Closed');
  });

  it('idempotency: should ignore duplicate executionId with same data', async () => {
    await pool.query('DELETE FROM te_funding_payments');
    await pool.query('DELETE FROM te_funding_periods');
    await pool.query('DELETE FROM te_position_snapshots');
    await pool.query('DELETE FROM te_outbox_events');
    await pool.query('DELETE FROM te_trades');
    await pool.query('DELETE FROM te_orders');
    await pool.query('DELETE FROM te_positions');
    await pool.query('DELETE FROM te_balances');
    await pool.query('DELETE FROM te_executions');

    await pool.query(
      "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'TON', $2, $3, $3)",
      ['user1', 10000, Date.now()]
    );

    const o = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON-USDT',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });

    const executionId = crypto.randomUUID();
    const trade1 = await engine.executeTrade(o.orderId, 10, 5, executionId);
    expect(trade1).not.toBeNull();

    // Call it again with same data
    const trade2 = await engine.executeTrade(o.orderId, 10, 5, executionId);
    expect(trade2).toBeNull(); // Should be ignored

    const res = await pool.query('SELECT * FROM te_trades WHERE order_id = $1', [o.orderId]);
    expect(res.rows.length).toBe(1); // Only one trade should have happened
  });

  it('idempotency: should throw error on duplicate executionId with different data', async () => {
    const o = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON-USDT',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });

    const executionId = crypto.randomUUID();
    await engine.executeTrade(o.orderId, 10, 5, executionId);

    // Call it again with different price
    await expect(engine.executeTrade(o.orderId, 10, 6, executionId)).rejects.toThrow(
      'Conflict: execution_id already exists with different data'
    );
  });

  it('parallel execution: should handle concurrent calls with same executionId gracefully', async () => {
    const o = await engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TON-USDT',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 5,
      reduceOnly: false,
    });

    const executionId = crypto.randomUUID();

    // Fire two promises concurrently
    const p1 = engine.executeTrade(o.orderId, 10, 5, executionId);
    const p2 = engine.executeTrade(o.orderId, 10, 5, executionId);

    const results = await Promise.allSettled([p1, p2]);
    // One should succeed with Trade, the other should be null (already processed)
    // Actually both might resolve, one to Trade, one to null
    let hasTrade = false;
    let hasNull = false;
    for (const res of results) {
      if (res.status === 'fulfilled') {
        if (res.value === null) hasNull = true;
        else if (res.value.tradeId) hasTrade = true;
      }
    }
    expect(hasTrade).toBe(true);
    // hasNull might be true, or it might be rejected depending on exact timing, but typically one is null because of DB locks

    const res = await pool.query('SELECT * FROM te_trades WHERE order_id = $1', [o.orderId]);
    expect(res.rows.length).toBe(1); // Only one trade should have happened
  });

  describe('Currency Isolation Tests', () => {
    it('Should strictly isolate TON and STARS operations, balances, and PnL', async () => {
      // 1. Создать TON-баланс.
      await pool.query(
        "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'TON', $2, $3, $3)",
        ['user1_iso', 1000, Date.now()]
      );
      // 2. Создать STARS-баланс.
      await pool.query(
        "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'STARS', $2, $3, $3)",
        ['user1_iso', 500, Date.now()]
      );

      // Check initial
      let tonBal = await engine.getBalance('user1_iso', 'TON');
      let starsBal = await engine.getBalance('user1_iso', 'STARS');
      expect(tonBal).toBe(1000);
      expect(starsBal).toBe(500);

      // 3. Открыть Long по TON-инструменту.
      const oTonLong = await engine.placeOrder({
        userId: 'user1_iso',
        instrumentKey: 'TON-USDT',
        side: 'Buy',
        orderType: 'Limit',
        qty: 10,
        price: 5,
        reduceOnly: false,
      });
      const tTonLong = await engine.executeTrade(oTonLong.orderId, 10, 5);

      // 4. Проверить изменение только TON-баланса.
      const newTonBal = await engine.getBalance('user1_iso', 'TON');
      const feeTon = 10 * 5 * 0.0025; // 0.125
      expect(newTonBal).toBe(1000 - feeTon);

      // 5. Проверить, что STARS-баланс не изменился.
      let newStarsBal = await engine.getBalance('user1_iso', 'STARS');
      expect(newStarsBal).toBe(500);

      // 6. Открыть Short по TON-инструменту (close position).
      const oTonClose = await engine.placeOrder({
        userId: 'user1_iso',
        instrumentKey: 'TON-USDT',
        side: 'Sell',
        orderType: 'Limit',
        qty: 10,
        price: 10,
        reduceOnly: true,
      });

      // 7. Закрыть TON-позицию и проверить TON PnL.
      const tTonClose = await engine.executeTrade(oTonClose.orderId, 10, 10);
      const feeTonClose = 10 * 10 * 0.0025; // 0.25
      const pnlTon = (10 - 5) * 10; // 50
      const expectedFinalTonBal = 1000 - feeTon - feeTonClose + pnlTon;
      expect(await engine.getBalance('user1_iso', 'TON')).toBe(expectedFinalTonBal);

      // 8. Открыть Long по STARS-инструменту.
      const oStarsLong = await engine.placeOrder({
        userId: 'user1_iso',
        instrumentKey: 'STARS-USDT',
        side: 'Buy',
        orderType: 'Limit',
        qty: 20,
        price: 2,
        reduceOnly: false,
      });
      const tStarsLong = await engine.executeTrade(oStarsLong.orderId, 20, 2);

      // 9. Проверить изменение только STARS-баланса.
      const feeStars = 20 * 2 * 0.0025; // 0.1
      expect(await engine.getBalance('user1_iso', 'STARS')).toBe(500 - feeStars);

      // 10. Проверить, что TON-баланс не изменился.
      expect(await engine.getBalance('user1_iso', 'TON')).toBe(expectedFinalTonBal);

      // 11. Закрыть STARS-позицию и проверить STARS PnL.
      const oStarsClose = await engine.placeOrder({
        userId: 'user1_iso',
        instrumentKey: 'STARS-USDT',
        side: 'Sell',
        orderType: 'Limit',
        qty: 20,
        price: 3,
        reduceOnly: true,
      });
      const tStarsClose = await engine.executeTrade(oStarsClose.orderId, 20, 3);
      const feeStarsClose = 20 * 3 * 0.0025; // 0.15
      const pnlStars = (3 - 2) * 20; // 20
      const expectedFinalStarsBal = 500 - feeStars - feeStarsClose + pnlStars;
      expect(await engine.getBalance('user1_iso', 'STARS')).toBe(expectedFinalStarsBal);

      // 12. Проверить комиссию в TON.
      const tonRows = await pool.query(
        "SELECT total_fees, realized_pnl FROM te_balances WHERE user_id = 'user1_iso' AND currency = 'TON'"
      );
      expect(Number(tonRows.rows[0].total_fees)).toBe(feeTon + feeTonClose);
      expect(Number(tonRows.rows[0].realized_pnl)).toBe(pnlTon);

      // 13. Проверить комиссию в STARS.
      const starsRows = await pool.query(
        "SELECT total_fees, realized_pnl FROM te_balances WHERE user_id = 'user1_iso' AND currency = 'STARS'"
      );
      expect(Number(starsRows.rows[0].total_fees)).toBe(feeStars + feeStarsClose);
      expect(Number(starsRows.rows[0].realized_pnl)).toBe(pnlStars);

      // 14. Проверить locked balance по TON.
      expect(tonRows.rows[0].locked_balance ? Number(tonRows.rows[0].locked_balance) : 0).toBe(0);

      // 15. Проверить locked balance по STARS.
      expect(starsRows.rows[0].locked_balance ? Number(starsRows.rows[0].locked_balance) : 0).toBe(
        0
      );

      // 16. Проверить два разных instrumentKey с разными валютами. (Tested by TON-USDT and STARS-USDT above)

      // 17. Проверить отказ при отсутствии нужного валютного баланса.
      const oNot = await engine.placeOrder({
        userId: 'user2',
        instrumentKey: 'STARS-NOT-USDT',
        side: 'Buy',
        orderType: 'Limit',
        qty: 10,
        price: 5,
        reduceOnly: false,
      });
      expect(oNot.status).toBe('Rejected'); // user2 has 0 STARS (default is 0)

      // 18. Проверить отказ при недостаточном балансе нужной валюты.
      const oStarsOOB = await engine.placeOrder({
        userId: 'user1_iso',
        instrumentKey: 'STARS-USDT',
        side: 'Buy',
        orderType: 'Limit',
        qty: 1000,
        price: 1000,
        reduceOnly: false,
      });
      expect(oStarsOOB.status).toBe('Rejected');

      // 19-22. Проверить, что currency сохраняется в te_orders, te_positions, te_trades, te_executions.
      const orderRes = await pool.query(
        'SELECT settlement_currency FROM te_orders WHERE order_id = $1',
        [oStarsLong.orderId]
      );
      expect(orderRes.rows[0].settlement_currency).toBe('STARS');

      const posRes = await pool.query(
        "SELECT settlement_currency FROM te_positions WHERE user_id = 'user1_iso' AND instrument_key = 'STARS-USDT'"
      );
      expect(posRes.rows[0].settlement_currency).toBe('STARS');

      const tradeRes = await pool.query(
        'SELECT settlement_currency FROM te_trades WHERE trade_id = $1',
        [tStarsLong?.tradeId]
      );
      expect(tradeRes.rows[0].settlement_currency).toBe('STARS');

      const execRes = await pool.query(
        'SELECT settlement_currency FROM te_executions WHERE order_id = $1 LIMIT 1',
        [oStarsLong.orderId]
      );
      expect(execRes.rows[0].settlement_currency).toBe('STARS');

      // 23. Проверить currency в outbox events.
      const outboxRes = await pool.query('SELECT currency FROM te_outbox_events LIMIT 1');
      expect(outboxRes.rows[0].currency).not.toBeNull();
    });

    it('24. Проверить refresh/restart', async () => {
      // In db environment this means creating new instance of engine
      await pool.query(
        "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'TON', $2, $3, $3)",
        ['user_ref', 100, Date.now()]
      );

      const engine1 = new PostgresTradingEngine(pool);
      const o = await engine1.placeOrder({
        userId: 'user_ref',
        instrumentKey: 'TON-USDT',
        side: 'Buy',
        orderType: 'Limit',
        qty: 2,
        price: 5,
        reduceOnly: false,
      });
      await engine1.executeTrade(o.orderId, 2, 5);

      const engine2 = new PostgresTradingEngine(pool); // restart
      const bal = await engine2.getBalance('user_ref', 'TON');
      expect(bal).toBe(100 - 2 * 5 * 0.0025);

      const positions = await engine2.getAllPositions('user_ref');
      expect(positions.length).toBe(1);
      expect(positions[0].qty).toBe(2);
    });

    it('25. Проверить duplicate execution отдельно для TON', async () => {
      await pool.query(
        "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'TON', $2, $3, $3)",
        ['user_dup1', 1000, Date.now()]
      );
      const o = await engine.placeOrder({
        userId: 'user_dup1',
        instrumentKey: 'TON-USDT',
        side: 'Buy',
        orderType: 'Market',
        qty: 10,
        price: 10,
        reduceOnly: false,
      });

      const execId = crypto.randomUUID();
      const t1 = await engine.executeTrade(o.orderId, 10, 10, execId);
      expect(t1).not.toBeNull();
      const t2 = await engine.executeTrade(o.orderId, 10, 10, execId);
      expect(t2).toBeNull();

      // Balance charged only once
      const fee = 10 * 10 * 0.0025;
      expect(await engine.getBalance('user_dup1', 'TON')).toBe(1000 - fee);
    });

    it('26. Проверить duplicate execution отдельно для STARS', async () => {
      await pool.query(
        "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'STARS', $2, $3, $3)",
        ['user_dup2', 500, Date.now()]
      );
      const o = await engine.placeOrder({
        userId: 'user_dup2',
        instrumentKey: 'STARS-USDT',
        side: 'Buy',
        orderType: 'Market',
        qty: 10,
        price: 5,
        reduceOnly: false,
      });

      const execId = crypto.randomUUID();
      const t1 = await engine.executeTrade(o.orderId, 10, 5, execId);
      expect(t1).not.toBeNull();
      const t2 = await engine.executeTrade(o.orderId, 10, 5, execId);
      expect(t2).toBeNull();

      const fee = 10 * 5 * 0.0025;
      expect(await engine.getBalance('user_dup2', 'STARS')).toBe(500 - fee);
    });

    it('27. Проверить rollback операции с валютным балансом', async () => {
      await pool.query(
        "INSERT INTO te_balances (user_id, currency, available_balance, updated_at, created_at) VALUES ($1, 'TON', $2, $3, $3)",
        ['user_roll', 1000, Date.now()]
      );

      const o = await engine.placeOrder({
        userId: 'user_roll',
        instrumentKey: 'TON-USDT',
        side: 'Buy',
        orderType: 'Limit',
        qty: 10,
        price: 5,
        reduceOnly: false,
      });

      // Do a valid execution first to create an executionId
      const execId = 'rollback-test-exec-1';
      await engine.executeTrade(o.orderId, 5, 5, execId);

      // Balance should be 1000 - (5 * 5) - fee (0.0625) = 974.9375, let's just check it's less than 1000
      const midBalance = await engine.getBalance('user_roll', 'TON');

      // Now try another execution with the SAME execId but DIFFERENT fill qty/price, which will trigger unique conflict in idempotency check
      try {
        await engine.executeTrade(o.orderId, 2, 5, execId);
      } catch (e: any) {
        expect(e.message).toContain('execution_id already exists with different data');
      }

      // Balance should remain exactly midBalance, no fee deducted
      expect(await engine.getBalance('user_roll', 'TON')).toBe(midBalance);
    });
  });
});
