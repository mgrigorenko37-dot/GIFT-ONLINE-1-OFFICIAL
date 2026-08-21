import re

with open('server/trading/types.ts', 'r') as f:
    content = f.read()

# Add Decimal import if not exists
if "import Decimal" not in content:
    content = "import Decimal from 'decimal.js';\n" + content

content = content.replace("export interface MarginInfo {", """export interface MarginInfo {
  walletBalanceDec?: Decimal;
  equityDec?: Decimal;
  usedMarginDec?: Decimal;
  availableBalanceDec?: Decimal;
  totalUnrealizedPnlDec?: Decimal;
  totalUsedMarginDec?: Decimal;
  totalOrderMarginDec?: Decimal;
  maintenanceMarginDec?: Decimal;
  marginRatioDec?: Decimal;""")

content = content.replace("export interface Position {", """export interface Position {
  qtyDec?: Decimal;
  avgEntryPriceDec?: Decimal;
  markPriceDec?: Decimal;""")

content = content.replace("export interface Order {", """export interface Order {
  qtyDec?: Decimal;
  priceDec?: Decimal;
  remainingQtyDec?: Decimal;
  executedQtyDec?: Decimal;
  avgFillPriceDec?: Decimal;""")

with open('server/trading/types.ts', 'w') as f:
    f.write(content)

