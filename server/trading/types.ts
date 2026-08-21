import Decimal from 'decimal.js';
export interface Order {
  qtyDec?: Decimal;
  priceDec?: Decimal;
  remainingQtyDec?: Decimal;
  executedQtyDec?: Decimal;
  avgFillPriceDec?: Decimal;
  orderId: string;
  userId: string;
  instrumentKey: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  qty: number;
  price: number;
  reduceOnly: boolean;
  positionEffect?: 'Open' | 'Close' | 'LIQUIDATE';
  rejectionReason?: string;
  status: 'Open' | 'PartiallyFilled' | 'Filled' | 'Cancelled' | 'Rejected';
  executedQty: number;
  remainingQty: number;
  avgFillPrice: number;
  fee: number;
  settlementCurrency: string;
  feeCurrency: string;
  pnlCurrency: string;
  collateralCurrency: string;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  qtyDec?: Decimal;
  avgEntryPriceDec?: Decimal;
  markPriceDec?: Decimal;
  positionId: string;
  userId: string;
  instrumentKey: string;
  side: 'Long' | 'Short';
  qty: number;
  avgEntryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status:
    | 'Open'
    | 'Closed'
    | 'Liquidated'
    | 'MarginCall'
    | 'PendingLiquidation'
    | 'LiquidationFailed'
    | 'OPEN'
    | 'MARGIN_CALL'
    | 'PENDING_LIQUIDATION'
    | 'LIQUIDATED'
    | 'CLOSED'
    | 'LIQUIDATION_FAILED';
  settlementCurrency: string;
  pnlCurrency: string;
  collateralCurrency: string;
  openedAt: number;
  updatedAt: number;
  liquidationReason?: string;
  liquidationTimestamp?: number;
}

export interface Trade {
  tradeId: string;
  orderId: string;
  userId: string;
  instrumentKey: string;
  side: 'Buy' | 'Sell';
  qty: number;
  price: number;
  fee: number;
  feeCurrency: string;
  realizedPnl?: number;
  positionId?: string;
  pnlCurrency: string;
  settlementCurrency: string;
  timestamp: number;
}

export interface FundingPayment {
  fundingId: string;
  positionId: string;
  userId: string;
  instrumentKey: string;
  currency: string;
  side: 'Long' | 'Short';
  fundingRate: number;
  fundingInterval: string;
  fundingTimestamp: number;
  markPrice: number;
  qty: number;
  notional: number;
  fundingAmount: number;
  status: 'PROCESSED' | 'SKIPPED' | 'FAILED';
  createdAt: number;
  processedAt: number;
  errorReason?: string;
}

export interface FundingPeriodSnapshot {
  instrumentKey: string;
  currency: string;
  fundingInterval: string;
  fundingTimestamp: number;
  fundingRate: number;
  markPrice: number;
  createdAt: number;
}

export interface PositionSnapshot {
  snapshotId: string;
  positionId: string;
  userId: string;
  instrumentKey: string;
  side: 'Long' | 'Short';
  qty: number;
  avgEntryPrice: number;
  status: string;
  settlementCurrency?: string;
  collateralCurrency?: string;
  validFrom: number;
  validTo?: number | null;
  createdAt: number;
}

export interface ProcessFundingOptions {
  instrumentKey?: string;
  currency?: string;
  positionId?: string;
  userId?: string;
  fundingRate?: number;
  overrideMarkPrice?: number;
  fundingInterval?: string;
  fundingTimestamp?: number;
  isCatchUp?: boolean;
}

export interface InstrumentCurrencyConfig {
  settlementCurrency: string;
  collateralCurrency: string;
  feeCurrency: string;
  pnlCurrency: string;
  maintenanceMarginRate: number;
  liquidationFeeRate: number;
  liquidationBuffer?: number;
  markPriceSource: string;
  maxLiquidationRetries: number;
}

export interface MarginInfo {
  walletBalanceDec?: Decimal;
  equityDec?: Decimal;
  usedMarginDec?: Decimal;
  availableBalanceDec?: Decimal;
  totalUnrealizedPnlDec?: Decimal;
  totalUsedMarginDec?: Decimal;
  totalOrderMarginDec?: Decimal;
  maintenanceMarginDec?: Decimal;
  marginRatioDec?: Decimal;
  walletBalance: number;
  equity: number;
  usedMargin: number;
  availableBalance: number;
  totalUnrealizedPnl: number;
  totalUsedMargin: number;
  totalOrderMargin: number;
  maintenanceMargin: number;
  marginRatio: number;
}
