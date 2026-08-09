import { describe, it, expect, beforeEach } from 'vitest';
import { TradingEngine } from './TradingEngine';
import fs from 'fs';
import path from 'path';

describe('TradingEngine - Long Only Lifecycle', () => {
  let engine: TradingEngine;
  const testDataPath = path.resolve(process.cwd(), '.data', 'test_trading_engine.json');

  beforeEach(() => {
    if (fs.existsSync(testDataPath)) {
      fs.unlinkSync(testDataPath);
    }
    engine = new TradingEngine(testDataPath);
  });

  it('открыть Long', () => {
    const order = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(order.orderId, 10, 100);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos).toBeDefined();
    expect(pos.side).toBe('Long');
    expect(pos.qty).toBe(10);
    expect(pos.status).toBe('Open');
    expect(engine.getBalance('user1')).toBe(12480.5 - 1000); // 12480.5 is default
  });

  it('увеличить Long', () => {
    const buy1 = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy1.orderId, 10, 100);

    const buy2 = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 200,
      reduceOnly: false
    });
    engine.executeTrade(buy2.orderId, 10, 200);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos.qty).toBe(20);
    expect(pos.avgEntryPrice).toBe(150);
  });

  it('закрыть Long с прибылью', () => {
    const buy = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy.orderId, 10, 100);

    const sell = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 150,
      reduceOnly: true
    });
    engine.executeTrade(sell.orderId, 10, 150);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
    expect(pos.realizedPnl).toBe(500); // 10 * (150 - 100)
    expect(engine.getBalance('user1')).toBe(12480.5 - 1000 + 1500);
  });

  it('закрыть Long с убытком', () => {
    const buy = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy.orderId, 10, 100);

    const sell = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 50,
      reduceOnly: true
    });
    engine.executeTrade(sell.orderId, 10, 50);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
    expect(pos.realizedPnl).toBe(-500); // 10 * (50 - 100)
  });

  it('частично закрыть Long', () => {
    const buy = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy.orderId, 10, 100);

    const sell = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 4,
      price: 150,
      reduceOnly: true
    });
    engine.executeTrade(sell.orderId, 4, 150);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Open');
    expect(pos.qty).toBe(6);
    expect(pos.realizedPnl).toBe(200); // 4 * (150 - 100)
  });

  it('полностью закрыть Long', () => {
    const buy = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy.orderId, 10, 100);

    const sell = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 150,
      reduceOnly: true
    });
    engine.executeTrade(sell.orderId, 10, 150);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
  });

  it('закрыть несуществующий Long', () => {
    const sell = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 10,
      price: 150,
      reduceOnly: true
    });
    expect(sell.status).toBe('Rejected');
  });

  it('закрыть больше доступного количества (ограничиваем)', () => {
    const buy = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy.orderId, 10, 100);

    const sell = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 15,
      price: 120,
      reduceOnly: true
    });
    
    expect(sell.qty).toBe(10);
    expect(sell.remainingQty).toBe(10);
  });

  it('убедиться, что закрытие Long не открывает Short', () => {
    const buy = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy.orderId, 10, 100);

    const sell = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Sell',
      orderType: 'Market',
      qty: 15,
      price: 120,
      reduceOnly: false // Even with false, we clamped it in placeOrder logic for Long only
    });
    engine.executeTrade(sell.orderId, 15, 120);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos.status).toBe('Closed');
    expect(pos.qty).toBe(0);
    expect(pos.side).toBe('Long');
  });

  it('duplicate execution не меняет позицию дважды', () => {
    const buy = engine.placeOrder({
      userId: 'user1',
      instrumentKey: 'TEST:all:all:TON',
      side: 'Buy',
      orderType: 'Market',
      qty: 10,
      price: 100,
      reduceOnly: false
    });
    engine.executeTrade(buy.orderId, 10, 100);
    
    // Attempt duplicate execution
    const executedAgain = engine.executeTrade(buy.orderId, 10, 100);
    expect(executedAgain).toBe(null);

    const pos = engine.getPosition('user1', 'TEST:all:all:TON')!;
    expect(pos.qty).toBe(10);
    expect(pos.avgEntryPrice).toBe(100);
  });
});
