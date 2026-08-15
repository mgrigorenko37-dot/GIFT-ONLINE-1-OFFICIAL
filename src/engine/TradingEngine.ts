import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export type Side = 'Buy' | 'Sell';
export type PositionSide = 'Long' | 'Short';
export type OrderType = 'Market' | 'Limit';
export type OrderStatus = 'Open' | 'PartiallyFilled' | 'Filled' | 'Cancelled' | 'Rejected';
export type PositionStatus = 'Open' | 'Closed';

export interface Order {
  rejectionReason?: string;
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
  settlementCurrency?: string;
  feeCurrency?: string;
  pnlCurrency?: string;
  collateralCurrency?: string;
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
  settlementCurrency?: string;
  pnlCurrency?: string;
  collateralCurrency?: string;
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
  fee: number;
  feeCurrency?: string;
  realizedPnl?: number;
  pnlCurrency?: string;
  settlementCurrency?: string;
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
    if (this.dataPath !== ':memory:') {
      this.loadState();
    }
  }

  private loadState() {
    if (this.dataPath === ':memory:') return;
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
    if (this.dataPath === ':memory:') return;
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

  public getBalance(userId: string, currency: string = 'TON'): number {
    const key = `${userId}:${currency}`;
    if (this.balances.has(key)) {
      return this.balances.get(key)!;
    }
    if (currency === 'TON' && this.balances.has(userId)) {
      return this.balances.get(userId)!;
    }
    return currency === 'TON' ? 12480.5 : 0;
  }

  public setBalance(userId: string, amount: number, currency: string = 'TON') {
    const key = `${userId}:${currency}`;
    this.balances.set(key, amount);
    if (currency === 'TON') {
      this.balances.set(userId, amount);
    }
  }

  public placeOrder(
    orderData: Omit<
      Order,
      | 'orderId'
      | 'status'
      | 'executedQty'
      | 'remainingQty'
      | 'avgFillPrice'
      | 'fee'
      | 'createdAt'
      | 'updatedAt'
    >,
    initialBalanceDeduct?: boolean
  ): Order {
    const now = Date.now();
    const isStars =
      orderData.instrumentKey.endsWith(':STARS') ||
      orderData.instrumentKey.includes('STARS') ||
      orderData.instrumentKey === 'star';
    const currency = isStars ? 'STARS' : 'TON';

    const order: Order = {
      ...orderData,
      orderId: Math.random().toString(36).substring(2, 11),
      status: 'Open',
      executedQty: 0,
      remainingQty: orderData.qty,
      avgFillPrice: 0,
      fee: 0,
      settlementCurrency: orderData.settlementCurrency || currency,
      feeCurrency: orderData.feeCurrency || currency,
      pnlCurrency: orderData.pnlCurrency || currency,
      collateralCurrency: orderData.collateralCurrency || currency,
      createdAt: now,
      updatedAt: now,
    };

    const posKey = `${order.userId}:${order.instrumentKey}`;
    const position = this.positions.get(posKey);
    const hasPosition = position && position.status === 'Open';

    if (order.reduceOnly && !hasPosition) {
      order.status = 'Rejected';
      this.orders.set(order.orderId, order);
      this.saveState();
      return order;
    }

    if (hasPosition) {
      if (position.side === 'Long') {
        if (order.side === 'Buy' && order.reduceOnly) {
          order.status = 'Rejected';
          this.orders.set(order.orderId, order);
          this.saveState();
          return order;
        }
        if (order.side === 'Sell') {
          // Reducing Long
          if (order.qty > position.qty) {
            order.qty = position.qty;
            order.remainingQty = position.qty;
          }
        }
      } else if (position.side === 'Short') {
        if (order.side === 'Sell' && order.reduceOnly) {
          order.status = 'Rejected';
          this.orders.set(order.orderId, order);
          this.saveState();
          return order;
        }
        if (order.side === 'Buy') {
          // Reducing Short
          if (order.qty > position.qty) {
            order.qty = position.qty;
            order.remainingQty = position.qty;
          }
        }
      }
    }

    const availBalance = this.getBalance(order.userId, currency);
    const requiredCollateral = order.qty * (order.price || 0);
    if (!order.reduceOnly && requiredCollateral > 0 && availBalance < requiredCollateral) {
      order.status = 'Rejected';
      order.rejectionReason = `Insufficient funds in ${currency} balance`;
      this.orders.set(order.orderId, order);
      this.saveState();
      return order;
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
    return Array.from(this.positions.values()).filter((p) => p.userId === userId);
  }

  public getUserTrades(userId: string): Trade[] {
    return this.trades.filter((t) => t.userId === userId);
  }

  public updateMarkPrice(instrumentKey: string, markPrice: number) {
    for (const position of this.positions.values()) {
      if (position.instrumentKey === instrumentKey && position.status === 'Open') {
        position.markPrice = markPrice;
        const pnlMultiplier = position.side === 'Long' ? 1 : -1;
        position.unrealizedPnl =
          (markPrice - position.avgEntryPrice) * position.qty * pnlMultiplier;
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

    const totalCost = order.avgFillPrice * order.executedQty + fillPrice * fillQty;
    const fee = fillQty * fillPrice * 0.0025;

    order.executedQty += fillQty;
    order.fee += fee;
    order.remainingQty -= fillQty;
    order.avgFillPrice = totalCost / order.executedQty;
    order.updatedAt = Date.now();

    if (order.remainingQty === 0) {
      order.status = 'Filled';
    } else {
      order.status = 'PartiallyFilled';
    }

    const isStars =
      order.instrumentKey.endsWith(':STARS') ||
      order.instrumentKey.includes('STARS') ||
      order.instrumentKey === 'star';
    const currency = isStars ? 'STARS' : 'TON';

    const trade: Trade = {
      tradeId: Math.random().toString(36).substring(2, 11),
      orderId: order.orderId,
      userId: order.userId,
      instrumentKey: order.instrumentKey,
      side: order.side,
      qty: fillQty,
      price: fillPrice,
      timestamp: Date.now(),
      fee: fee,
      feeCurrency: currency,
      pnlCurrency: currency,
      settlementCurrency: currency,
    };
    this.trades.push(trade);

    if ((order as any).realizedPnl !== undefined) {
      (trade as any).realizedPnl = (order as any).realizedPnl;
    }

    // 1. execution/trade
    this.emit('tradeExecuted', trade);

    // 3. position update (must happen first so we can grab realizedPnl)
    const posKey = `${order.userId}:${order.instrumentKey}`;
    const oldPosition = this.positions.get(posKey);
    const hasOldPosition = oldPosition && oldPosition.status === 'Open';
    const oldPnl = hasOldPosition ? oldPosition.realizedPnl : 0;

    this.updatePosition(order, fillQty, fillPrice);

    const newPosition = this.positions.get(posKey);
    const newPnl = newPosition ? newPosition.realizedPnl : 0;

    if (
      order.reduceOnly ||
      (hasOldPosition && oldPosition.side !== (order.side === 'Buy' ? 'Long' : 'Short'))
    ) {
      (order as any).realizedPnl = newPnl - oldPnl;
      (order as any).positionEffect = 'Close';
    } else {
      (order as any).positionEffect = 'Open';
    }

    trade.realizedPnl = (order as any).realizedPnl || 0;

    // 2. order update
    this.emit('orderUpdated', order);

    // 4. balance update (isolated by currency)
    const currentBalance = this.getBalance(order.userId, currency);
    const currentTradeRealizedPnl =
      order.reduceOnly ||
      (hasOldPosition && oldPosition.side !== (order.side === 'Buy' ? 'Long' : 'Short'))
        ? newPnl - oldPnl
        : 0;

    const newBalance = currentBalance - fee + currentTradeRealizedPnl;
    this.setBalance(order.userId, newBalance, currency);
    this.emit('balanceUpdated', {
      userId: order.userId,
      balance: newBalance,
      availableBalance: newBalance,
      lockedBalance: 0,
      currency,
    });

    // 5. history update
    this.emit('historyUpdated', { userId: order.userId, trade });

    this.saveState();
    return trade;
  }

  private updatePosition(order: Order, fillQty: number, fillPrice: number) {
    const posKey = `${order.userId}:${order.instrumentKey}`;
    let position = this.positions.get(posKey);

    const isBuy = order.side === 'Buy';
    const isStars =
      order.instrumentKey.endsWith(':STARS') ||
      order.instrumentKey.includes('STARS') ||
      order.instrumentKey === 'star';
    const currency = isStars ? 'STARS' : 'TON';

    if (!position || position.status === 'Closed') {
      // Open new position
      position = {
        positionId: Math.random().toString(36).substring(2, 11),
        userId: order.userId,
        instrumentKey: order.instrumentKey,
        side: isBuy ? 'Long' : 'Short',
        qty: fillQty,
        avgEntryPrice: fillPrice,
        markPrice: fillPrice,
        unrealizedPnl: 0,
        realizedPnl: 0,
        status: 'Open',
        settlementCurrency: currency,
        pnlCurrency: currency,
        collateralCurrency: currency,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.positions.set(posKey, position);
      this.emit('positionUpdated', position);
      return;
    }

    // Position exists
    const isIncrease = (position.side === 'Long' && isBuy) || (position.side === 'Short' && !isBuy);

    if (isIncrease) {
      // Increase position
      const totalValue = position.qty * position.avgEntryPrice + fillQty * fillPrice;
      position.qty += fillQty;
      position.avgEntryPrice = totalValue / position.qty;
      position.updatedAt = Date.now();
      this.emit('positionUpdated', position);
    } else {
      // Decrease position
      const pnlMultiplier = position.side === 'Long' ? 1 : -1;
      const realizedPnl = (fillPrice - position.avgEntryPrice) * fillQty * pnlMultiplier;
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
