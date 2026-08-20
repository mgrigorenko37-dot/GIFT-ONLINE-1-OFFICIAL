import { EventEmitter } from 'events';
import { Pool, PoolClient } from 'pg';
import {
  Order,
  Position,
  Trade,
  FundingPayment,
  FundingPeriodSnapshot,
  PositionSnapshot,
  ProcessFundingOptions,
  InstrumentCurrencyConfig,
  MarginInfo,
} from './types';
import { getInstrumentConfig } from './instrumentConfig';
import { mapOrder, mapPosition, mapTrade } from './mappers';
import * as balanceManager from './balanceManager';
import * as positionManager from './positionManager';
import * as orderManager from './orderManager';
import * as liquidationManager from './liquidationManager';
import * as fundingManager from './fundingManager';

export * from './types';
export * from './instrumentConfig';
export * from './mappers';
export * from './fundingManager';

export class PostgresTradingEngine extends EventEmitter {
  private pool: Pool;

  constructor(pool: Pool) {
    super();
    this.pool = pool;
  }

  private async lockMarginResources(client: PoolClient | any, userId: string, currency: string) {
    return balanceManager.lockMarginResources(client, userId, currency);
  }

  public async calculateMargin(
    client: PoolClient | any,
    userId: string,
    currency: string
  ): Promise<MarginInfo> {
    return balanceManager.calculateMargin(client, userId, currency);
  }

  public async getMarginInfo(userId: string, currency: string): Promise<MarginInfo> {
    return balanceManager.getMarginInfo(this.pool, userId, currency);
  }

  public async getBalance(userId: string, currency: string = 'TON'): Promise<number> {
    return balanceManager.getBalance(this.pool, userId, currency);
  }

  public async getAllPositions(userId: string): Promise<Position[]> {
    return positionManager.getAllPositions(this.pool, userId);
  }

  public async getUserOrders(userId: string): Promise<Order[]> {
    return orderManager.getUserOrders(this.pool, userId);
  }

  public async getActiveOrders(instrumentKey: string): Promise<Order[]> {
    return orderManager.getActiveOrders(this.pool, instrumentKey);
  }

  public async getUserTrades(userId: string): Promise<Trade[]> {
    return positionManager.getUserTrades(this.pool, userId);
  }

  public async getOrder(orderId: string): Promise<Order | undefined> {
    return orderManager.getOrder(this.pool, orderId);
  }

  public mapOrder(r: any): Order {
    return mapOrder(r);
  }

  public mapPosition(r: any): Position {
    return mapPosition(r);
  }

  public mapTrade(r: any): Trade {
    return mapTrade(r);
  }

  public async placeOrder(
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
      | 'positionEffect'
      | 'rejectionReason'
      | 'settlementCurrency'
      | 'feeCurrency'
      | 'pnlCurrency'
      | 'collateralCurrency'
    > & {
      settlementCurrency?: string;
      feeCurrency?: string;
      pnlCurrency?: string;
      collateralCurrency?: string;
    },
    initialBalanceDeduct?: boolean
  ): Promise<Order> {
    return orderManager.placeOrder(this.pool, orderData, initialBalanceDeduct);
  }

  public async cancelOrder(orderId: string): Promise<Order | null> {
    return orderManager.cancelOrder(this.pool, orderId);
  }

  public async executeTrade(
    orderId: string,
    fillQty: number,
    fillPrice: number,
    executionId?: string,
    options?: { source?: string; externalExecutionId?: string }
  ): Promise<Trade | null> {
    return orderManager.executeTrade(
      this.pool,
      orderId,
      fillQty,
      fillPrice,
      executionId,
      options
    );
  }

  public async updateMarkPrice(instrumentKey: string, markPrice: number): Promise<void> {
    return positionManager.updateMarkPrice(
      this.pool,
      instrumentKey,
      markPrice,
      (client, userId, currency) => this.liquidateUser(client, userId, currency)
    );
  }

  public async liquidateUser(
    clientArg: any,
    userId: string,
    currency: string,
    executionIdOrOptions?: string | { executionId?: string; tradeId?: string },
    tradeIdParam?: string
  ): Promise<any> {
    return liquidationManager.liquidateUser(
      this.pool,
      clientArg,
      userId,
      currency,
      executionIdOrOptions,
      tradeIdParam
    );
  }

  public async createFundingPeriodSnapshot(
    snapshot: {
      instrumentKey: string;
      currency: string;
      fundingInterval?: string;
      fundingTimestamp: number;
      fundingRate: number;
      markPrice: number;
      createdAt?: number;
    },
    clientArg?: any
  ): Promise<FundingPeriodSnapshot> {
    return fundingManager.createFundingPeriodSnapshot(this.pool, snapshot, clientArg);
  }

  public async recordPositionSnapshot(
    position: {
      positionId: string;
      userId: string;
      instrumentKey: string;
      side: 'Long' | 'Short' | string;
      qty: number;
      avgEntryPrice: number;
      status: string;
      settlementCurrency?: string;
      collateralCurrency?: string;
    },
    validFrom?: number,
    validTo?: number | null,
    clientArg?: any
  ): Promise<PositionSnapshot> {
    return positionManager.recordPositionSnapshot(
      position,
      validFrom,
      validTo,
      clientArg,
      this.pool
    );
  }

  public async getPositionSnapshotAt(
    positionId: string,
    timestamp: number,
    clientArg?: any
  ): Promise<PositionSnapshot | null> {
    return positionManager.getPositionSnapshotAt(positionId, timestamp, clientArg, this.pool);
  }

  public async getFundingPeriodSnapshot(
    instrumentKey: string,
    currency: string,
    fundingInterval: string,
    fundingTimestamp: number,
    clientArg?: any
  ): Promise<FundingPeriodSnapshot | null> {
    return fundingManager.getFundingPeriodSnapshot(
      this.pool,
      instrumentKey,
      currency,
      fundingInterval,
      fundingTimestamp,
      clientArg
    );
  }

  public async applyFundingRate(
    clientArg: any,
    options: ProcessFundingOptions
  ): Promise<FundingPayment[]> {
    return fundingManager.applyFundingRate(this.pool, clientArg, options);
  }

  public async getFundingPayments(userId: string): Promise<FundingPayment[]> {
    return fundingManager.getFundingPayments(this.pool, userId);
  }

  public async processMissedFundingPeriods(options: {
    lastProcessedTimestamp?: number;
    currentTimestamp?: number;
    intervalMs: number;
    fundingRate?: number;
    overrideMarkPrice?: number;
    fundingInterval?: string;
    currency?: string;
    instrumentKey?: string;
  }): Promise<
    {
      timestamp: number;
      payments: FundingPayment[];
      status?: 'PROCESSED' | 'SKIPPED';
      errorReason?: string;
    }[]
  > {
    return fundingManager.processMissedFundingPeriods(this.pool, options);
  }
}
