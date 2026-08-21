import re

with open('server/trading/liquidationManager.ts', 'r') as f:
    content = f.read()

if "import Decimal" not in content:
    content = "import Decimal from 'decimal.js';\n" + content

# 1. totalRealizedLoss = 0 -> new Decimal(0)
# 2. newBalance = Number(bal.available_balance) + totalRealizedLoss - totalLiquidationFee
content = re.sub(
    r'let totalRealizedLoss = 0;',
    'let totalRealizedLoss = 0;\n  let totalRealizedLossDec = new Decimal(0);',
    content
)

content = re.sub(
    r'let totalLiquidationFee = 0;',
    'let totalLiquidationFee = 0;\n  let totalLiquidationFeeDec = new Decimal(0);',
    content
)

content = re.sub(
    r'const realizedLoss = \(pos\.avgEntryPrice - pos\.markPrice\) \* pos\.qty;',
    r'const realizedLossDec = new Decimal(pos.avgEntryPrice).minus(new Decimal(pos.markPrice)).mul(new Decimal(pos.qty));\n        const realizedLoss = realizedLossDec.toNumber();',
    content
)
content = re.sub(
    r'const realizedLoss = \(pos\.markPrice - pos\.avgEntryPrice\) \* pos\.qty;',
    r'const realizedLossDec = new Decimal(pos.markPrice).minus(new Decimal(pos.avgEntryPrice)).mul(new Decimal(pos.qty));\n        const realizedLoss = realizedLossDec.toNumber();',
    content
)

content = re.sub(
    r'totalRealizedLoss \+= realizedLoss;',
    r'totalRealizedLoss += realizedLoss;\n        totalRealizedLossDec = totalRealizedLossDec.plus(realizedLossDec);',
    content
)

content = re.sub(
    r'const liqFee = pos\.qty \* pos\.markPrice \* \(config\.liquidationFeeRate \|\| 0\.01\);',
    r'const liqFeeDec = new Decimal(pos.qty).mul(new Decimal(pos.markPrice)).mul(new Decimal(config.liquidationFeeRate || 0.01));\n        const liqFee = liqFeeDec.toNumber();',
    content
)

content = re.sub(
    r'totalLiquidationFee \+= liqFee;',
    r'totalLiquidationFee += liqFee;\n        totalLiquidationFeeDec = totalLiquidationFeeDec.plus(liqFeeDec);',
    content
)

content = re.sub(
    r'const newBalance = Number\(bal\.available_balance\) \+ totalRealizedLoss - totalLiquidationFee;\n\s*const finalBalance = newBalance <= 0 \? 0 : newBalance;',
    r'''const availableBeforeDec = new Decimal(bal.available_balance);
      const lockedBeforeDec = new Decimal(bal.locked_balance || 0);
      const newBalanceDec = availableBeforeDec.plus(totalRealizedLossDec).minus(totalLiquidationFeeDec);
      const finalBalanceDec = newBalanceDec.lte(0) ? new Decimal(0) : newBalanceDec;
      
      const newBalance = newBalanceDec.toNumber();
      const finalBalance = finalBalanceDec.toNumber();''',
    content
)

content = re.sub(
    r'\[\n\s*finalBalance,\n\s*updatedMargin\.usedMargin,\n\s*totalLiquidationFee,\n\s*totalRealizedLoss,\n\s*nowMs,\n\s*userId,\n\s*currency,\n\s*\]',
    r'''[
          finalBalanceDec.toString(),
          (updatedMargin.usedMarginDec || new Decimal(updatedMargin.usedMargin)).toString(),
          totalLiquidationFeeDec.toString(),
          totalRealizedLossDec.toString(),
          nowMs,
          userId,
          currency,
        ]''',
    content
)


# Inject audit log right after balance update
audit_log = """
      await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'LIQUIDATION',
          userId,
          `liq_${nowMs}`,
          currency,
          totalRealizedLossDec.minus(totalLiquidationFeeDec).abs().toString(),
          availableBeforeDec.toString(),
          finalBalanceDec.toString(),
          lockedBeforeDec.toString(),
          (updatedMargin.usedMarginDec || new Decimal(updatedMargin.usedMargin)).toString(),
          JSON.stringify({ totalRealizedLoss: totalRealizedLossDec.toString(), totalLiquidationFee: totalLiquidationFeeDec.toString() }),
          nowMs
        ]
      );
"""
content = re.sub(
    r'(UPDATE te_balances.*?\);)',
    r'\1\n' + audit_log,
    content,
    flags=re.DOTALL
)

with open('server/trading/liquidationManager.ts', 'w') as f:
    f.write(content)
