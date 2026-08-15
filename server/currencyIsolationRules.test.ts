import { describe, it, expect } from 'vitest';
import { TradingEngine } from '../src/engine/TradingEngine';

describe('Strict Currency Isolation Rules', () => {
  it('1 & 2. Trading TON instrument does not alter STARS balance and vice versa', () => {
    const engine = new TradingEngine(':memory:');
    engine.setBalance('user_100', 1000, 'TON');
    engine.setBalance('user_100', 500, 'STARS');

    expect(engine.getBalance('user_100', 'TON')).toBe(1000);
    expect(engine.getBalance('user_100', 'STARS')).toBe(500);

    // Trade TON instrument
    const tonOrder = engine.placeOrder({
      userId: 'user_100',
      instrumentKey: 'coll1:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 2,
      price: 10,
      reduceOnly: false,
    });
    engine.executeTrade(tonOrder.orderId, 2, 10);

    // TON fee = 2 * 10 * 0.0025 = 0.05 -> TON balance = 999.95
    expect(engine.getBalance('user_100', 'TON')).toBe(999.95);
    // STARS balance MUST remain unchanged at 500
    expect(engine.getBalance('user_100', 'STARS')).toBe(500);

    // Trade STARS instrument
    const starsOrder = engine.placeOrder({
      userId: 'user_100',
      instrumentKey: 'coll1:all:all:STARS',
      side: 'Buy',
      orderType: 'Market',
      qty: 5,
      price: 20,
      reduceOnly: false,
    });
    engine.executeTrade(starsOrder.orderId, 5, 20);

    // STARS fee = 5 * 20 * 0.0025 = 0.25 -> STARS balance = 499.75
    expect(engine.getBalance('user_100', 'STARS')).toBe(499.75);
    // TON balance MUST remain unchanged at 999.95
    expect(engine.getBalance('user_100', 'TON')).toBe(999.95);
  });

  it('3 & 4. PnL and fee recorded only in corresponding currency', () => {
    const engine = new TradingEngine(':memory:');
    engine.setBalance('user_101', 100, 'STARS');

    // Open Long position on STARS instrument
    const o1 = engine.placeOrder({
      userId: 'user_101',
      instrumentKey: 'star:all:all:STARS',
      side: 'Buy',
      orderType: 'Market',
      qty: 2,
      price: 10,
      reduceOnly: false,
    });
    const t1 = engine.executeTrade(o1.orderId, 2, 10);

    expect(t1?.feeCurrency).toBe('STARS');
    expect(t1?.pnlCurrency).toBe('STARS');
    expect(t1?.settlementCurrency).toBe('STARS');

    // Close position with profit (+10 STARS)
    const o2 = engine.placeOrder({
      userId: 'user_101',
      instrumentKey: 'star:all:all:STARS',
      side: 'Sell',
      orderType: 'Market',
      qty: 2,
      price: 15,
      reduceOnly: true,
    });
    const t2 = engine.executeTrade(o2.orderId, 2, 15);

    expect(t2?.realizedPnl).toBe(10);
    expect(t2?.pnlCurrency).toBe('STARS');

    // Fee for o1 = 0.05, Fee for o2 = 0.075 -> total fees = 0.125
    // Profit = 10 -> Net STARS = 100 - 0.125 + 10 = 109.875
    expect(engine.getBalance('user_101', 'STARS')).toBe(109.875);
  });

  it('6 & 7. Trade, position and outbox events include exact currency', () => {
    const engine = new TradingEngine(':memory:');
    engine.setBalance('user_102', 1000, 'STARS');

    let balanceEventCurrency = '';
    engine.on('balanceUpdated', (evt) => {
      balanceEventCurrency = evt.currency;
    });

    const o = engine.placeOrder({
      userId: 'user_102',
      instrumentKey: 'coll2:all:all:STARS',
      side: 'Buy',
      orderType: 'Market',
      qty: 1,
      price: 100,
      reduceOnly: false,
    });

    expect(o.settlementCurrency).toBe('STARS');
    expect(o.feeCurrency).toBe('STARS');
    expect(o.pnlCurrency).toBe('STARS');

    const trade = engine.executeTrade(o.orderId, 1, 100);
    expect(trade?.settlementCurrency).toBe('STARS');
    expect(balanceEventCurrency).toBe('STARS');

    const pos = engine.getPosition('user_102', 'coll2:all:all:STARS');
    expect(pos?.settlementCurrency).toBe('STARS');
    expect(pos?.pnlCurrency).toBe('STARS');
    expect(pos?.collateralCurrency).toBe('STARS');
  });

  it('10. Order rejected if funds in required currency are insufficient', () => {
    const engine = new TradingEngine(':memory:');
    engine.setBalance('user_103', 10000, 'TON');
    engine.setBalance('user_103', 10, 'STARS'); // Only 10 STARS

    // Try placing order for 100 STARS
    const starsOrder = engine.placeOrder({
      userId: 'user_103',
      instrumentKey: 'coll1:all:all:STARS',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 20, // Costs 200 STARS
      reduceOnly: false,
    });

    expect(starsOrder.status).toBe('Rejected');
    expect(starsOrder.rejectionReason).toContain('STARS');
  });
});
