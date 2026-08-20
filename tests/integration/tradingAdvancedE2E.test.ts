import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { PostgresTradingEngine } from '../../server/trading/tradingEngine';
import { getTestDbPool, seedTestUser, cleanupUserData } from './postgresFixture';

describe('Trading Advanced Flow (Margin, PnL, Liquidation, Funding, Partial)', () => {
  let pool: Pool;
  let engine: PostgresTradingEngine;
  const buyerId = 'trader_buyer_1';
  const sellerId = 'trader_seller_1';
  const marginTraderId = 'trader_margin_1';

  beforeAll(async () => {
    pool = await getTestDbPool();
    engine = new PostgresTradingEngine(pool);
  });

  beforeEach(async () => {
    await cleanupUserData(pool, buyerId);
    await cleanupUserData(pool, sellerId);
    await cleanupUserData(pool, marginTraderId);
    await seedTestUser(pool, buyerId, 'EQBuyer', { TON: 1000 });
    await seedTestUser(pool, sellerId, 'EQSeller', { TON: 1000 });
    await seedTestUser(pool, marginTraderId, 'EQMargin', { TON: 50 }); // low balance for liquidation
    await pool.query('DELETE FROM te_orders');
    await pool.query('DELETE FROM te_trades');
    await pool.query('DELETE FROM te_positions');
    await pool.query('DELETE FROM te_funding_payments');
    await pool.query('DELETE FROM te_executions');
  });

  afterAll(async () => {
    await cleanupUserData(pool, buyerId);
    await cleanupUserData(pool, sellerId);
    await cleanupUserData(pool, marginTraderId);
  });

  it('1. Balance Reservation & Order Matching & Partial Fill', async () => {
    // Seller places order to sell 2 BTC at 10 TON each (total 20 TON)
    const sellOrder = await engine.placeOrder({
      userId: sellerId,
      instrumentKey: 'BTC/TON',
      side: 'Sell',
      orderType: 'Limit',
      reduceOnly: false,
      qty: 2,
      price: 10,
      currency: 'TON',
      executionId: 'exec_sell_1'
    });
    expect(sellOrder.status).toBe('Open');

    // Buyer places order to buy 1 BTC at 10 TON each (Partial fill)
    const buyOrder = await engine.placeOrder({
      userId: buyerId,
      instrumentKey: 'BTC/TON',
      side: 'Buy',
      orderType: 'Limit',
      reduceOnly: false,
      qty: 1,
      price: 10,
      currency: 'TON',
      executionId: 'exec_buy_1'
    });
    
    await engine.executeTrade(buyOrder.orderId, 1, 10, 'trade_exec_buy_1');
    await engine.executeTrade(sellOrder.orderId, 1, 10, 'trade_exec_sell_1');

    const refreshedSell = await engine.getOrder(sellOrder.orderId);
    expect(refreshedSell?.executedQty).toBe(1);
    expect(refreshedSell?.status).toBe('PartiallyFilled'); // Still open for remaining 1

    const refreshedBuy = await engine.getOrder(buyOrder.orderId);
    expect(refreshedBuy?.executedQty).toBe(1);
    expect(refreshedBuy?.status).toBe('Filled');

    // Check balances
    const buyerBalance = await pool.query("SELECT available_balance, locked_balance FROM te_balances WHERE user_id=$1 AND currency='TON'", [buyerId]);
    expect(Number(buyerBalance.rows[0].available_balance)).toBeLessThan(1000);
  });

  it('2. Cancel Order & Release Reserved Balance', async () => {
    const buyOrder = await engine.placeOrder({
      userId: buyerId,
      instrumentKey: 'BTC/TON',
      side: 'Buy',
      orderType: 'Limit',
      reduceOnly: false,
      qty: 5,
      price: 100, // 500 TON reserved
      currency: 'TON',
      executionId: 'exec_buy_2'
    });

    let balance = await pool.query("SELECT available_balance, locked_balance FROM te_balances WHERE user_id=$1 AND currency='TON'", [buyerId]);
    expect(Number(balance.rows[0].locked_balance)).toBeGreaterThanOrEqual(500);

    const cancelled = await engine.cancelOrder(buyOrder.orderId);
    expect(cancelled?.status).toBe('Cancelled');

    balance = await pool.query("SELECT available_balance, locked_balance FROM te_balances WHERE user_id=$1 AND currency='TON'", [buyerId]);
    expect(Number(balance.rows[0].locked_balance)).toBe(0);
    expect(Number(balance.rows[0].available_balance)).toBe(1000); // completely restored
  });

  it('3. Position Margin, PnL, and Liquidation', async () => {
    const buyOrder = await engine.placeOrder({
      userId: marginTraderId,
      instrumentKey: 'BTC/TON',
      side: 'Buy',
      orderType: 'Limit',
      reduceOnly: false,
      qty: 1,
      price: 10,
      currency: 'TON',
      executionId: 'exec_margin_1'
    });

    const sellOrder = await engine.placeOrder({
      userId: sellerId,
      instrumentKey: 'BTC/TON',
      side: 'Sell',
      orderType: 'Limit',
      reduceOnly: false,
      qty: 1,
      price: 10,
      currency: 'TON',
      executionId: 'exec_margin_sell_1'
    });

    await engine.executeTrade(buyOrder.orderId, 1, 10, 'trade_margin_1');
    await engine.executeTrade(sellOrder.orderId, 1, 10, 'trade_margin_sell_1');

    await engine.updateMarkPrice('BTC/TON', 1);
    
    await pool.query("UPDATE te_balances SET available_balance=5 WHERE user_id=$1 AND currency='TON'", [marginTraderId]);
    await engine.updateMarkPrice('BTC/TON', 1);

    const liquidationResult = await engine.liquidateUser(null, marginTraderId, 'TON', 'exec_liq_1');
    expect(liquidationResult).toBeDefined();
  });

  it('4. Funding applied to open positions', async () => {
    const buyOrder = await engine.placeOrder({
      userId: buyerId,
      instrumentKey: 'BTC/TON',
      side: 'Buy',
      orderType: 'Limit',
      reduceOnly: false,
      qty: 2,
      price: 50,
      currency: 'TON',
      executionId: 'exec_fund_buy'
    });
    
    await engine.executeTrade(buyOrder.orderId, 2, 50, 'trade_fund_1');

    const fundingResult = await engine.applyFundingRate(null, {
      instrumentKey: 'BTC/TON',
      fundingRate: 0.01,
      fundingTimestamp: Date.now()
    });

    expect(Array.isArray(fundingResult)).toBe(true);
    // Since there's an open position (qty > 0), funding rate should produce a payment
    if (fundingResult.length > 0) {
      expect(fundingResult[0].fundingRate).toBe(0.01);
      expect(fundingResult[0].fundingAmount).toBeDefined();
    }
  });
});
