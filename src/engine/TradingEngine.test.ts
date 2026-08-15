import { describe, it, expect, beforeEach } from 'vitest';
import { TradingEngine } from './TradingEngine';
import fs from 'fs';
import path from 'path';

describe('TradingEngine - Long/Short Lifecycle', () => {
  let engine: TradingEngine;
  const testDataPath = path.resolve(process.cwd(), '.data', 'test_trading_engine.json');

  beforeEach(() => {
    if (fs.existsSync(testDataPath)) {
      fs.unlinkSync(testDataPath);
    }
    engine = new TradingEngine(testDataPath);
  });

  // --- Long Tests ---

  it('1. Buy + reduceOnly=false: should open a Long position', () => {
    const order = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });

    engine.executeTrade(order.orderId, 10, 100);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos).toBeDefined();
    expect(pos.side).toBe('Long');
    expect(pos.qty).toBe(10);
    expect(pos.status).toBe('Open');
  });

  it('2. Sell when no position exists and reduceOnly=false: should open Short', () => {
    const order = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 5,
      price: 150,
      reduceOnly: false,
    });

    engine.executeTrade(order.orderId, 5, 150);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos).toBeDefined();
    expect(pos.side).toBe('Short');
    expect(pos.qty).toBe(5);
  });

  it('3. Buy + reduceOnly=true when no position exists: should reject', () => {
    const order = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Limit',
      qty: 5,
      price: 150,
      reduceOnly: true,
    });

    expect(order.status).toBe('Rejected');
  });

  it('4. Sell + reduceOnly=true when no position exists: should reject', () => {
    const order = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Limit',
      qty: 5,
      price: 150,
      reduceOnly: true,
    });

    expect(order.status).toBe('Rejected');
  });

  // --- Short Tests ---

  it('Sell открывает Short', () => {
    const order = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });
    engine.executeTrade(order.orderId, 10, 100);

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos).toBeDefined();
    expect(pos.side).toBe('Short');
    expect(pos.qty).toBe(10);
    expect(pos.status).toBe('Open');
  });

  it('падение цены и Buy закрывает Short с прибылью', () => {
    const sell = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100, // Sold at 100
      reduceOnly: false,
    });
    engine.executeTrade(sell.orderId, 10, 100);

    const buy = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 50, // Bought back at 50
      reduceOnly: true,
    });
    engine.executeTrade(buy.orderId, 10, 50);

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
    expect(pos.realizedPnl).toBe(500); // 10 * (100 - 50)
  });

  it('рост цены и Buy закрывает Short с убытком', () => {
    const sell = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100, // Sold at 100
      reduceOnly: false,
    });
    engine.executeTrade(sell.orderId, 10, 100);

    const buy = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 150, // Bought back at 150
      reduceOnly: true,
    });
    engine.executeTrade(buy.orderId, 10, 150);

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
    expect(pos.realizedPnl).toBe(-500); // 10 * (100 - 150)
  });

  it('повторный Sell увеличивает Short', () => {
    const sell1 = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });
    engine.executeTrade(sell1.orderId, 10, 100);

    const sell2 = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 50,
      reduceOnly: false,
    });
    engine.executeTrade(sell2.orderId, 10, 50);

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos.qty).toBe(20);
    expect(pos.avgEntryPrice).toBe(75);
  });

  it('частичный Buy закрывает часть Short', () => {
    const sell = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });
    engine.executeTrade(sell.orderId, 10, 100);

    const buy = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 4,
      price: 50,
      reduceOnly: true,
    });
    engine.executeTrade(buy.orderId, 4, 50);

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Open');
    expect(pos.qty).toBe(6);
    expect(pos.realizedPnl).toBe(200); // 4 * (100 - 50)
  });

  it('полный Buy закрывает Short', () => {
    const sell = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });
    engine.executeTrade(sell.orderId, 10, 100);

    const buy = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 50,
      reduceOnly: true,
    });
    engine.executeTrade(buy.orderId, 10, 50);

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
  });

  it('Buy для закрытия Short не открывает Long (ограничение)', () => {
    const sell = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });
    engine.executeTrade(sell.orderId, 10, 100);

    const buy = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 15,
      price: 50,
      reduceOnly: false, // false should still clamp if we only allow one way and no auto-reverse
    });
    engine.executeTrade(buy.orderId, 15, 50);

    // We clamped qty to 10
    expect(buy.qty).toBe(10);
    expect(buy.remainingQty).toBe(0); // remaining after execution

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
    expect(pos.side).toBe('Short'); // retains last side
  });

  it('duplicate execution не закрывает Short дважды', () => {
    const sell = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false,
    });
    engine.executeTrade(sell.orderId, 10, 100);

    const buy = engine.placeOrder({
      userId: 'user2',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 50,
      reduceOnly: true,
    });
    engine.executeTrade(buy.orderId, 10, 50);

    const executedAgain = engine.executeTrade(buy.orderId, 10, 50);
    expect(executedAgain).toBe(null);

    const pos = engine.getPosition('user2', 'TEST:all:all:TON')!;
    expect(pos.qty).toBe(0);
    expect(pos.status).toBe('Closed');
  });
});
