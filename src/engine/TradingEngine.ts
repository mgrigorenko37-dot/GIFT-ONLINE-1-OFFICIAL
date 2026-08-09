import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export type Side = 'Buy' | 'Sell';
export type PositionSide = 'Long' | 'Short';
export type OrderType = 'Market' | 'Limit';
export type OrderStatus = 'Open' | 'PartiallyFilled' | 'Filled' | 'Cancelled' | 'Rejected';
export type PositionStatus = 'Open' | 'Closed';

export interface Order {
  orderId: string;
  userId: string;
  instrumentKey: string;
  side: Side;
  orderType: OrderType;
  qty: number;
  price: number;
  status: OrderStatus;
  reduceOnly: boolean;
  positionEffect?: 'Open' | 'Close';
  executedQty: number;
  remainingQty: number;
  avgFillPrice: number;
  fee: number;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  positionId: string;
  userId: string;
  instrumentKey: string;
  side: PositionSide;
  qty: number;
  avgEntryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status: PositionStatus;
  openedAt: number;
  updatedAt: number;
}

export interface Trade {
  tradeId: string;
  orderId: string;
  userId: string;
  instrumentKey: string;
  side: Side;
  qty: number;
  price: number;
  timestamp: number;
}

export class TradingEngine extends EventEmitter {
  private orders: Map<string, Order> = new Map();
  private positions: Map<string, Position> = new Map(); // key: userId:instrumentKey
  private balances: Map<string, number> = new Map();
  private trades: Trade[] = [];
  private dataPath: string;

  constructor(dataPath?: string) {
    super();
    this.dataPath = dataPath || path.resolve(process.cwd(), '.data', 'trading_engine.json');
    this.loadState();
  }

  private loadState() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        this.orders = new Map(data.orders || []);
        this.positions = new Map(data.positions || []);
        this.balances = new Map(data.balances || []);
        this.trades = data.trades || [];
      }
    } catch (e) {
      console.error('Failed to load trading engine state', e);
    }
  }

  public saveState() {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        orders: Array.from(this.orders.entries()),
        positions: Array.from(this.positions.entries()),
        balances: Array.from(this.balances.entries()),
        trades: this.trades,
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Failed to save trading engine state', e);
    }
  }

  public getBalance(userId: string): number {
    return this.balances.get(userId) || 12480.5; // Default initial balance matching frontend
  }

  public setBalance(userId: string, amount: number) {
    this.balances.set(userId, amount);
  }

  public placeOrder(orderData: Omit<Order, 'orderId' | 'status' | 'executedQty' | 'remainingQty' | 'avgFillPrice' | 'fee' | 'createdAt' | 'updatedAt'>, initialBalanceDeduct?: boolean): Order {
    const now = Date.now();
    const order: Order = {
      ...orderData,
      orderId: Math.random().toString(36).substring(2, 11),
      status: 'Open',
      executedQty: 0,
      remainingQty: orderData.qty,
      avgFillPrice: 0,
      fee: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Enforcement of "Long only" lifecycle for now
    const posKey = `${order.userId}:${order.instrumentKey}`;
    const position = this.positions.get(posKey);
    const hasLongPosition = position && position.status === 'Open' && position.side === 'Long';

    if (order.side === 'Sell') {
      if (!hasLongPosition) {
        order.status = 'Rejected';
        this.orders.set(order.orderId, order);
        this.saveState();
        return order;
      }
      
      // If we have a long position, any sell can only reduce it.
      if (order.qty > position.qty) {
        order.qty = position.qty;
        order.remainingQty = position.qty;
      }
    }

    if (order.reduceOnly) {
      if (order.side === 'Buy') {
        order.status = 'Rejected';
        this.orders.set(order.orderId, order);
        this.saveState();
        return order;
      }
    }

    if (order.side === 'Buy' && order.orderType === 'Limit' && initialBalanceDeduct) {
      const currentBalance = this.getBalance(order.userId);
      this.setBalance(order.userId, currentBalance - (order.price * order.qty));
    }

    this.orders.set(order.orderId, order);
    this.saveState();
    this.emit('orderPlaced', order);
    return order;
  }

  public cancelOrder(orderId: string): Order | null {
    const order = this.orders.get(orderId);
    if (!order) return null;

    if (order.status === 'Open' || order.status === 'PartiallyFilled') {
      order.status = 'Cancelled';
      order.updatedAt = Date.now();
      this.saveState();
      this.emit('orderCancelled', order);
      return order;
    }
    return null; // Cannot cancel Filled or already Cancelled/Rejected orders
  }

  public getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  public getPosition(userId: string, instrumentKey: string): Position | undefined {
    return this.positions.get(`${userId}:${instrumentKey}`);
  }

  public getAllPositions(userId: string): Position[] {
    return Array.from(this.positions.values()).filter(p => p.userId === userId);
  }

  public updateMarkPrice(instrumentKey: string, markPrice: number) {
    for (const position of this.positions.values()) {
      if (position.instrumentKey === instrumentKey && position.status === 'Open') {
        position.markPrice = markPrice;
        const pnlMultiplier = position.side === 'Long' ? 1 : -1;
        position.unrealizedPnl = (markPrice - position.avgEntryPrice) * position.qty * pnlMultiplier;
      }
    }
    this.saveState();
  }

  // Basic simulation of execution
  public executeTrade(orderId: string, fillQty: number, fillPrice: number): Trade | null {
    const order = this.orders.get(orderId);
    if (!order || (order.status !== 'Open' && order.status !== 'PartiallyFilled')) return null;

    if (fillQty <= 0) return null;

    if (fillQty > order.remainingQty) {
      fillQty = order.remainingQty;
    }

    if (fillQty === 0) return null;

    const totalCost = (order.avgFillPrice * order.executedQty) + (fillPrice * fillQty);
    
    order.executedQty += fillQty;
    order.remainingQty -= fillQty;
    order.avgFillPrice = totalCost / order.executedQty;
    order.updatedAt = Date.now();

    if (order.remainingQty === 0) {
      order.status = 'Filled';
    } else {
      order.status = 'PartiallyFilled';
    }

    // Update balances
    const currentBalance = this.getBalance(order.userId);
    if (order.side === 'Buy') {
      if (order.orderType === 'Market') {
        this.setBalance(order.userId, currentBalance - (fillQty * fillPrice));
        this.emit('balanceUpdated', { userId: order.userId, balance: this.getBalance(order.userId) });
      }
    } else {
      this.setBalance(order.userId, currentBalance + (fillQty * fillPrice));
      this.emit('balanceUpdated', { userId: order.userId, balance: this.getBalance(order.userId) });
    }

    this.updatePosition(order, fillQty, fillPrice);
    this.emit('orderUpdated', order);

    const trade: Trade = {
      tradeId: Math.random().toString(36).substring(2, 11),
      orderId: order.orderId,
      userId: order.userId,
      instrumentKey: order.instrumentKey,
      side: order.side,
      qty: fillQty,
      price: fillPrice,
      timestamp: Date.now()
    };
    this.trades.push(trade);

    this.saveState();
    this.emit('tradeExecuted', trade);
    return trade;
  }

  private updatePosition(order: Order, fillQty: number, fillPrice: number) {
    const posKey = `${order.userId}:${order.instrumentKey}`;
    let position = this.positions.get(posKey);

    const isBuy = order.side === 'Buy';

    if (!position || position.status === 'Closed') {
      if (isBuy) {
        position = {
          positionId: Math.random().toString(36).substring(2, 11),
          userId: order.userId,
          instrumentKey: order.instrumentKey,
          side: 'Long',
          qty: fillQty,
          avgEntryPrice: fillPrice,
          markPrice: fillPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          status: 'Open',
          openedAt: Date.now(),
          updatedAt: Date.now()
        };
        this.positions.set(posKey, position);
        this.emit('positionUpdated', position);
      }
      return;
    }

    // Position exists (is Long)
    if (isBuy) {
      // Increase Long position
      const totalValue = (position.qty * position.avgEntryPrice) + (fillQty * fillPrice);
      position.qty += fillQty;
      position.avgEntryPrice = totalValue / position.qty;
      position.updatedAt = Date.now();
      this.emit('positionUpdated', position);
    } else {
      // Decrease Long position (Sell)
      const realizedPnl = (fillPrice - position.avgEntryPrice) * fillQty;
      position.realizedPnl += realizedPnl;
      position.qty -= fillQty;
      position.updatedAt = Date.now();

      if (position.qty <= 0) {
        position.qty = 0;
        position.status = 'Closed';
      }
      this.emit('positionUpdated', position);
    }
  }
}
