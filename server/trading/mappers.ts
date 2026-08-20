import { Order, Position, Trade } from './types';
import { getInstrumentConfig } from './instrumentConfig';

export function mapOrder(r: any): Order {
  const config = getInstrumentConfig(r.instrument_key);
  return {
    orderId: r.order_id,
    userId: r.user_id,
    instrumentKey: r.instrument_key,
    side: r.side,
    orderType: r.order_type,
    qty: Number(r.qty),
    price: Number(r.price),
    reduceOnly: r.reduce_only,
    positionEffect: r.position_effect,
    rejectionReason: r.rejection_reason,
    status: r.status,
    executedQty: Number(r.executed_qty),
    remainingQty: Number(r.remaining_qty),
    avgFillPrice: Number(r.avg_fill_price),
    fee: Number(r.fee),
    settlementCurrency: r.settlement_currency || config.settlementCurrency,
    feeCurrency: r.fee_currency || config.feeCurrency,
    pnlCurrency: r.pnl_currency || config.pnlCurrency,
    collateralCurrency: r.collateral_currency || config.collateralCurrency,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function mapPosition(r: any): Position {
  const config = getInstrumentConfig(r.instrument_key);
  return {
    positionId: r.position_id || 'pos_' + r.user_id + '_' + r.instrument_key,
    userId: r.user_id,
    instrumentKey: r.instrument_key,
    side: r.side,
    qty: Number(r.qty),
    avgEntryPrice: Number(r.avg_entry_price),
    markPrice: Number(r.mark_price),
    unrealizedPnl: Number(r.unrealized_pnl),
    realizedPnl: Number(r.realized_pnl),
    status: r.status,
    settlementCurrency: r.settlement_currency || config.settlementCurrency,
    pnlCurrency: r.pnl_currency || config.pnlCurrency,
    collateralCurrency: r.collateral_currency || config.collateralCurrency,
    openedAt: Number(r.opened_at || r.created_at),
    updatedAt: Number(r.updated_at),
    liquidationTimestamp: r.liquidation_timestamp ? Number(r.liquidation_timestamp) : undefined,
    liquidationReason: r.liquidation_reason || undefined,
  };
}

export function mapTrade(r: any): Trade {
  const config = getInstrumentConfig(r.instrument_key);
  return {
    tradeId: r.trade_id,
    orderId: r.order_id,
    userId: r.user_id,
    instrumentKey: r.instrument_key,
    side: r.side,
    qty: Number(r.qty),
    price: Number(r.price),
    fee: Number(r.fee),
    feeCurrency: r.fee_currency || config.feeCurrency,
    realizedPnl: Number(r.realized_pnl),
    pnlCurrency: r.pnl_currency || config.pnlCurrency,
    settlementCurrency: r.settlement_currency || config.settlementCurrency,
    timestamp: Number(r.timestamp),
  };
}
