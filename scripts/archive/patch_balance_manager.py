import re

with open('server/trading/balanceManager.ts', 'r') as f:
    content = f.read()

if "import Decimal" not in content:
    content = "import Decimal from 'decimal.js';\n" + content

target = """export async function calculateMargin(
  client: PoolClient | any,
  userId: string,
  currency: string
): Promise<MarginInfo> {"""

replacement = """export async function calculateMargin(
  client: PoolClient | any,
  userId: string,
  currency: string
): Promise<MarginInfo> {
  const balRes = await client.query(
    'SELECT available_balance, locked_balance FROM te_balances WHERE user_id = $1 AND currency = $2',
    [userId, currency]
  );

  const walletBalanceDec = balRes.rows.length > 0 ? new Decimal(balRes.rows[0].available_balance) : new Decimal(0);
  const walletBalance = walletBalanceDec.toNumber();

  const posRes = await client.query(
    "SELECT qty, avg_entry_price, side, mark_price, instrument_key FROM te_positions WHERE user_id = $1 AND (collateral_currency = $2 OR collateral_currency IS NULL) AND status IN ('Open', 'MarginCall')",
    [userId, currency]
  );

  let totalUnrealizedPnlDec = new Decimal(0);
  let totalUsedMarginDec = new Decimal(0);
  let totalPositionNotionalDec = new Decimal(0);
  let maintenanceMarginDec = new Decimal(0);
  const leverageDec = new Decimal(1);

  for (const pos of posRes.rows) {
    const qtyDec = new Decimal(pos.qty);
    const entryPriceDec = new Decimal(pos.avg_entry_price);
    const markPriceDec = pos.mark_price != null ? new Decimal(pos.mark_price) : entryPriceDec;
    const side = pos.side;

    const config = getInstrumentConfig(pos.instrument_key);
    const maintenanceMarginRateDec = new Decimal(config.maintenanceMarginRate);

    const initialMarginDec = qtyDec.mul(entryPriceDec).div(leverageDec);
    totalUsedMarginDec = totalUsedMarginDec.plus(initialMarginDec);

    const notionalDec = qtyDec.mul(markPriceDec);
    totalPositionNotionalDec = totalPositionNotionalDec.plus(notionalDec);

    maintenanceMarginDec = maintenanceMarginDec.plus(notionalDec.mul(maintenanceMarginRateDec));

    const pnlMultiplierDec = side === 'Long' ? new Decimal(1) : new Decimal(-1);
    totalUnrealizedPnlDec = totalUnrealizedPnlDec.plus(markPriceDec.minus(entryPriceDec).mul(qtyDec).mul(pnlMultiplierDec));
  }

  const ordRes = await client.query(
    `SELECT remaining_qty, price FROM te_orders WHERE user_id = $1 AND collateral_currency = $2 AND status IN ('Open', 'PartiallyFilled') AND position_effect = 'Open'`,
    [userId, currency]
  );

  let totalOrderMarginDec = new Decimal(0);

  for (const ord of ordRes.rows) {
    const rQtyDec = new Decimal(ord.remaining_qty);
    const priceDec = new Decimal(ord.price || 0);
    totalOrderMarginDec = totalOrderMarginDec.plus(rQtyDec.mul(priceDec).div(leverageDec));
  }

  const usedMarginDec = totalUsedMarginDec.plus(totalOrderMarginDec);
  const equityDec = walletBalanceDec.plus(totalUnrealizedPnlDec);
  const availableBalanceDec = equityDec.minus(usedMarginDec);
  const marginRatioDec = totalPositionNotionalDec.gt(0) ? equityDec.div(totalPositionNotionalDec) : new Decimal(0);

  return {
    walletBalance,
    walletBalanceDec,
    equity: equityDec.toNumber(),
    equityDec,
    usedMargin: usedMarginDec.toNumber(),
    usedMarginDec,
    availableBalance: availableBalanceDec.toNumber(),
    availableBalanceDec,
    totalUnrealizedPnl: totalUnrealizedPnlDec.toNumber(),
    totalUnrealizedPnlDec,
    totalUsedMargin: totalUsedMarginDec.toNumber(),
    totalUsedMarginDec,
    totalOrderMargin: totalOrderMarginDec.toNumber(),
    totalOrderMarginDec,
    maintenanceMargin: maintenanceMarginDec.toNumber(),
    maintenanceMarginDec,
    marginRatio: marginRatioDec.toNumber(),
    marginRatioDec,
  };
}"""

# Remove old calculateMargin
content = re.sub(r'export async function calculateMargin.*?return \{.*?\};\n\}', replacement, content, flags=re.DOTALL)

with open('server/trading/balanceManager.ts', 'w') as f:
    f.write(content)

