import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

# For order creation (insert)
target_create = r'''      // 5. Update user balance locked margin
      await client.query\(
        `UPDATE te_balances SET locked_balance=\$1, updated_at=\$2 WHERE user_id=\$3 AND currency=\$4`,
        \[newLockedDec\.toString\(\), Date\.now\(\), order\.userId, order\.collateralCurrency\]
      \);'''

replacement_create = '''      // 5. Update user balance locked margin
      await client.query(
        `UPDATE te_balances SET locked_balance=$1, updated_at=$2 WHERE user_id=$3 AND currency=$4`,
        [newLockedDec.toString(), Date.now(), order.userId, order.collateralCurrency]
      );

      // 5.5 Emit financial audit
      await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'ORDER_CREATE_LOCK',
          order.userId,
          orderId,
          order.collateralCurrency,
          requiredMarginDec.toString(),
          (margin.availableBalanceDec || new Decimal(margin.availableBalance)).toString(),
          (margin.availableBalanceDec || new Decimal(margin.availableBalance)).minus(requiredMarginDec).toString(),
          (margin.usedMarginDec || new Decimal(margin.usedMargin)).toString(),
          newLockedDec.toString(),
          JSON.stringify({ orderId, instrument: order.instrumentKey }),
          Date.now()
        ]
      );'''

content = re.sub(target_create, replacement_create, content)

# For trade execution
target_exec = r'''      // 8\. Обновление баланса \(available, locked, realized_pnl\)
      await client\.query\(
        `UPDATE te_balances SET available_balance=\$1, locked_balance=\$2, realized_pnl=\$3, total_fees=\$4, updated_at=\$5 WHERE user_id=\$6 AND currency=\$7`,
        \[newBalanceDec\.toString\(\), \(margin\.usedMarginDec \|\| new Decimal\(margin\.usedMargin\)\)\.toString\(\), newRealizedPnl, newTotalFees, Date\.now\(\), order\.userId, currency\]
      \);'''

replacement_exec = '''      // 8. Обновление баланса (available, locked, realized_pnl)
      await client.query(
        `UPDATE te_balances SET available_balance=$1, locked_balance=$2, realized_pnl=$3, total_fees=$4, updated_at=$5 WHERE user_id=$6 AND currency=$7`,
        [newBalanceDec.toString(), (margin.usedMarginDec || new Decimal(margin.usedMargin)).toString(), newRealizedPnl, newTotalFees, Date.now(), order.userId, currency]
      );

      // 8.5 Record financial audit
      await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'TRADE_EXECUTION',
          order.userId,
          tradeId,
          currency,
          pnlDec.minus(feeDec).abs().toString(),
          currentBalanceDecimal.toString(),
          newBalanceDec.toString(),
          (margin.usedMarginDec || new Decimal(margin.usedMargin)).toString(),
          (margin.usedMarginDec || new Decimal(margin.usedMargin)).toString(),
          JSON.stringify({ tradeId, fee: feeDec.toString(), pnl: pnlDec.toString() }),
          Date.now()
        ]
      );'''

content = re.sub(target_exec, replacement_exec, content)


with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
