import { describe, it } from 'vitest';
import { TradingEngine } from '../src/engine/TradingEngine.js';
import * as assert from 'assert';

describe('Trading Engine Unit Tests', () => {
  it('executes basic trading engine operations', () => {
    console.log('Running tests...');

    // 1. Long profit & Full close & Fees
    let engine = new TradingEngine();
    engine.setBalance('u1', 10000);
    let o1 = engine.placeOrder({
      userId: 'u1',
      instrumentKey: 'A',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 0,
      reduceOnly: false,
    });
    engine.executeTrade(o1.orderId, 10, 100);

    // Initial fee = 10 * 100 * 0.0025 = 2.5
    assert.strictEqual(
      engine.getBalance('u1'),
      9997.5,
      'Balance after Long open should deduct fee'
    );

    let o2 = engine.placeOrder({
      userId: 'u1',
      instrumentKey: 'A',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 0,
      reduceOnly: true,
    });
    engine.executeTrade(o2.orderId, 10, 150); // Profit: 50 * 10 = 500. Fee: 10 * 150 * 0.0025 = 3.75
    // New balance: 9997.5 + 500 - 3.75 = 10493.75
    assert.strictEqual(
      engine.getBalance('u1'),
      10493.75,
      'Balance after Long close should add profit and deduct fee'
    );

    let pos = engine.getPosition('u1', 'A');
    assert.strictEqual(pos?.status, 'Closed', 'Position should be closed');
    assert.strictEqual(pos?.qty, 0, 'Position qty should be 0');

    // 2. Short loss & partial close
    engine = new TradingEngine();
    engine.setBalance('u2', 10000);
    let o3 = engine.placeOrder({
      userId: 'u2',
      instrumentKey: 'B',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 0,
      reduceOnly: false,
    });
    engine.executeTrade(o3.orderId, 10, 100);

    // Fee = 2.5. Balance = 9997.5
    let o4 = engine.placeOrder({
      userId: 'u2',
      instrumentKey: 'B',
      side: 'Buy',
      orderType: 'Market',
      qty: 5,
      price: 0,
      reduceOnly: true,
    });
    engine.executeTrade(o4.orderId, 5, 120); // Loss: (100 - 120) * 5 = -100. Fee: 5 * 120 * 0.0025 = 1.5
    // Balance: 9997.5 - 100 - 1.5 = 9896.0
    assert.strictEqual(engine.getBalance('u2'), 9896.0, 'Balance after partial Short loss');

    pos = engine.getPosition('u2', 'B');
    assert.strictEqual(pos?.status, 'Open', 'Position should still be open');
    assert.strictEqual(pos?.qty, 5, 'Position qty should be 5');
    assert.strictEqual(pos?.realizedPnl, -100, 'Realized PnL should be -100');

    // 3. Duplicate execution protection
    // In our engine, execution requires state change, let's see what happens if we execute again
    let trade = engine.executeTrade(o4.orderId, 5, 120);
    assert.strictEqual(trade, null, 'Duplicate execution on filled order should return null');

    // 4. Short profit
    let o5 = engine.placeOrder({
      userId: 'u2',
      instrumentKey: 'B',
      side: 'Buy',
      orderType: 'Market',
      qty: 5,
      price: 0,
      reduceOnly: true,
    });
    engine.executeTrade(o5.orderId, 5, 80); // Profit: (100 - 80) * 5 = 100. Fee: 5 * 80 * 0.0025 = 1.0
    // Balance: 9896.0 + 100 - 1.0 = 9995.0
    assert.strictEqual(engine.getBalance('u2'), 9995.0, 'Balance after remaining Short profit');

    console.log('All tests passed!');
  });
});
