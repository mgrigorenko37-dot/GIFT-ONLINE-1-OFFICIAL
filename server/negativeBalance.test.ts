import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresTradingEngine, Order } from './tradingEngine';
import { Pool } from 'pg';

describe('Negative Balance Execution Rejection', () => {
  let pool: Pool;
  let engine: PostgresTradingEngine;

  beforeEach(() => {
    pool = {
      connect: vi.fn(),
      query: vi.fn(),
    } as unknown as Pool;
    engine = new PostgresTradingEngine(pool);
  });

  it('rejects execution if it would result in negative available balance', async () => {
    const client = {
      query: vi.fn(),
      release: vi.fn(),
    };
    (pool.connect as any).mockResolvedValue(client);

    const userId = 'user_poor';
    const instrumentKey = 'durov-cap:all:all:TON';
    const orderId = 'ord1';

    const initialOrder = {
      order_id: orderId,
      user_id: userId,
      instrument_key: instrumentKey,
      side: 'Buy',
      order_type: 'Market',
      qty: 1,
      price: 100,
      reduce_only: false,
      position_effect: 'Open',
      status: 'Open',
      executed_qty: 0,
      remaining_qty: 1,
      avg_fill_price: 0,
      fee: 0,
      collateral_currency: 'TON',
    };

    client.query.mockImplementation(async (queryStr: string, params: any[]) => {
      if (
        queryStr.includes('FROM te_orders WHERE order_id = $1') &&
        !queryStr.includes('FOR UPDATE')
      ) {
        return { rows: [initialOrder], rowCount: 1 };
      }
      if (queryStr.includes('FROM te_orders WHERE order_id = $1 FOR UPDATE')) {
        return { rows: [initialOrder], rowCount: 1 };
      }
      if (queryStr.includes('FROM te_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE')) {
        return {
          rows: [{ available_balance: 5, locked_balance: 0, realized_pnl: 0, total_fees: 0 }],
          rowCount: 1,
        };
      }
      if (
        queryStr.includes('FROM te_positions WHERE user_id = $1 AND instrument_key = $2 FOR UPDATE')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (
        queryStr.includes('FROM te_balances WHERE user_id = $1 AND currency = $2') &&
        !queryStr.includes('FOR UPDATE')
      ) {
        return {
          rows: [{ available_balance: 5, locked_balance: 0, realized_pnl: 0, total_fees: 0 }],
          rowCount: 1,
        };
      }
      if (queryStr.includes('FROM te_positions WHERE user_id = $1 AND collateral_currency = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (queryStr.includes('FROM te_orders WHERE user_id = $1 AND collateral_currency = $2')) {
        return { rows: [{ remaining_qty: 1, price: 100 }], rowCount: 1 };
      }
      if (queryStr.includes('FROM te_executions WHERE execution_id = $1 FOR UPDATE')) {
        return { rows: [], rowCount: 0 };
      }
      if (queryStr.startsWith('UPDATE te_orders SET status=$1')) {
        return { rowCount: 1 };
      }
      if (queryStr.startsWith('INSERT INTO te_executions')) {
        return { rowCount: 1 };
      }
      if (
        queryStr.startsWith('INSERT INTO te_positions') ||
        queryStr.startsWith('UPDATE te_positions')
      ) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const trade = await engine.executeTrade(orderId, 1, 100);
    expect(trade).toBeNull();

    // Check if INSERT INTO te_executions with REJECTED was called
    const insertExecCall = client.query.mock.calls.find(
      (c) => c[0].includes('INSERT INTO te_executions') && c[1].includes('REJECTED')
    );
    expect(insertExecCall).toBeDefined();

    // Check order update logic
    const updateOrderCall = client.query.mock.calls.find((c) =>
      c[0].includes('UPDATE te_orders SET status=$1, rejection_reason=$2')
    );
    expect(updateOrderCall).toBeDefined();
    expect(updateOrderCall![1][0]).toBe('Rejected');
    expect(updateOrderCall![1][1]).toContain('Insufficient margin');
  });
});
