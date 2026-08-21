import re

with open('server/trading/orderManager.ts', 'r') as f:
    content = f.read()

target_cancel = r'''      await client\.query\(
        `UPDATE te_balances SET locked_balance=\$1, updated_at=\$2 WHERE user_id=\$3 AND currency=\$4`,
        \[newLockedDec\.toString\(\), Date\.now\(\), order\.userId, order\.collateralCurrency\]
      \);'''

replacement_cancel = '''      await client.query(
        `UPDATE te_balances SET locked_balance=$1, updated_at=$2 WHERE user_id=$3 AND currency=$4`,
        [newLockedDec.toString(), Date.now(), order.userId, order.collateralCurrency]
      );

      await client.query(
        `INSERT INTO te_financial_audits (
          event_type, user_id, reference_id, currency, amount,
          available_before, available_after, locked_before, locked_after, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'ORDER_CANCEL_UNLOCK',
          order.userId,
          orderId,
          order.collateralCurrency,
          marginFreedDec.toString(),
          (updatedMargin.availableBalanceDec || new Decimal(updatedMargin.availableBalance)).toString(),
          (updatedMargin.availableBalanceDec || new Decimal(updatedMargin.availableBalance)).plus(marginFreedDec).toString(),
          (updatedMargin.usedMarginDec || new Decimal(updatedMargin.usedMargin)).toString(),
          newLockedDec.toString(),
          JSON.stringify({ orderId, instrument: order.instrumentKey }),
          Date.now()
        ]
      );'''

content = re.sub(target_cancel, replacement_cancel, content)

with open('server/trading/orderManager.ts', 'w') as f:
    f.write(content)
