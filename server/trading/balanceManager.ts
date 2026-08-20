import { Pool, PoolClient } from 'pg';
import { MarginInfo } from './types';
import { getInstrumentConfig } from './instrumentConfig';

export async function lockMarginResources(
  client: PoolClient | any,
  userId: string,
  currency: string
): Promise<void> {
  // 1. Lock currency Balance with FOR UPDATE
  await client.query(
    'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE',
    [userId, currency]
  );
  // 2. Lock Position with FOR UPDATE
  await client.query(
    'SELECT position_id FROM te_positions WHERE user_id = $1 AND collateral_currency = $2 FOR UPDATE',
    [userId, currency]
  );
  // 3. Lock Order with FOR UPDATE
  await client.query(
    'SELECT order_id FROM te_orders WHERE user_id = $1 AND collateral_currency = $2 FOR UPDATE',
    [userId, currency]
  );
}

export async function calculateMargin(
  client: PoolClient | any,
  userId: string,
  currency: string
): Promise<MarginInfo> {
  const balRes = await client.query(
    'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2',
    [userId, currency]
  );
  const walletBalance = balRes.rows.length > 0 ? Number(balRes.rows[0].available_balance) : 0;

  const posRes = await client.query(
    "SELECT qty, avg_entry_price, side, mark_price, instrument_key FROM te_positions WHERE user_id = $1 AND (collateral_currency = $2 OR collateral_currency IS NULL) AND status IN ('Open', 'MarginCall')",
    [userId, currency]
  );

  let totalUnrealizedPnl = 0;
  let totalUsedMargin = 0;
  let totalPositionNotional = 0;
  let maintenanceMargin = 0;
  const leverage = 1;

  for (const pos of posRes.rows) {
    const qty = Number(pos.qty);
    const entryPrice = Number(pos.avg_entry_price);
    const markPrice = pos.mark_price != null ? Number(pos.mark_price) : entryPrice;
    const side = pos.side;

    const config = getInstrumentConfig(pos.instrument_key);
    const maintenanceMarginRate = config.maintenanceMarginRate;

    const initialMargin = (qty * entryPrice) / leverage;
    totalUsedMargin += initialMargin;

    const notional = qty * markPrice;
    totalPositionNotional += notional;
    maintenanceMargin += notional * maintenanceMarginRate;

    const pnlMultiplier = side === 'Long' ? 1 : -1;
    totalUnrealizedPnl += (markPrice - entryPrice) * qty * pnlMultiplier;
  }

  const ordRes = await client.query(
    `SELECT remaining_qty, price FROM te_orders WHERE user_id = $1 AND collateral_currency = $2 AND status IN ('Open', 'PartiallyFilled') AND position_effect = 'Open'`,
    [userId, currency]
  );
  let totalOrderMargin = 0;
  for (const ord of ordRes.rows) {
    const rQty = Number(ord.remaining_qty);
    const price = Number(ord.price);
    totalOrderMargin += (rQty * price) / leverage;
  }

  const usedMargin = totalUsedMargin + totalOrderMargin;
  const equity = walletBalance + totalUnrealizedPnl;
  const availableBalance = equity - usedMargin;
  const marginRatio = totalPositionNotional > 0 ? equity / totalPositionNotional : 0;

  return {
    walletBalance,
    equity,
    usedMargin,
    availableBalance,
    totalUnrealizedPnl,
    totalUsedMargin,
    totalOrderMargin,
    maintenanceMargin,
    marginRatio,
  };
}

export async function getMarginInfo(
  pool: Pool,
  userId: string,
  currency: string
): Promise<MarginInfo> {
  const client = await pool.connect();
  try {
    return await calculateMargin(client, userId, currency);
  } finally {
    client.release();
  }
}

export async function getBalance(
  pool: Pool,
  userId: string,
  currency: string = 'TON'
): Promise<number> {
  const res = await pool.query(
    'SELECT available_balance FROM te_balances WHERE user_id = $1 AND currency = $2',
    [userId, currency]
  );
  if (res.rows.length === 0) return 0;
  return Number(res.rows[0].available_balance);
}
