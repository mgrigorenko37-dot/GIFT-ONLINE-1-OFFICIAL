import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { PostgresTradingEngine, Order } from './tradingEngine';
import { Pool } from 'pg';

describe('PostgresTradingEngine Atomicity and Multi-Instance', () => {
  let pool: Pool;

  beforeEach(() => {
    // We mock the pool to simulate transactions and concurrent access
    pool = {
      connect: vi.fn(),
      query: vi.fn(),
    } as unknown as Pool;
  });

  it('successful execution and outbox generation', async () => {
    const client = {
      query: vi.fn(),
      release: vi.fn(),
    };
    (pool.connect as any).mockResolvedValue(client);

    client.query.mockImplementation((q, values) => {
      if (q === 'BEGIN') return Promise.resolve();
      if (q === 'COMMIT') return Promise.resolve();
      if (q === 'ROLLBACK') return Promise.resolve();
      if (q.includes('FROM te_orders')) {
        return Promise.resolve({
          rows: [
            {
              order_id: 'ord1',
              remaining_qty: 10,
              status: 'Open',
              executed_qty: 0,
              avg_fill_price: 0,
              instrument_key: 'durov-cap:all:all:TON',
              user_id: 'user1',
              side: 'Buy',
              position_effect: 'Open',
              price: 100,
            },
          ],
        });
      }
      if (q.includes('SELECT * FROM te_positions')) {
        return Promise.resolve({ rows: [] });
      }
      if (q.includes('SELECT available_balance, locked_balance')) {
        return Promise.resolve({
          rows: [
            {
              available_balance: 2000,
              locked_balance: 0,
              realized_pnl: 0,
              total_fees: 0,
            },
          ],
        });
      }
      if (q.includes('SELECT * FROM te_balances')) {
        return Promise.resolve({
          rows: [
            {
              available_balance: 2000,
              locked_balance: 0,
              realized_pnl: 0,
              total_fees: 0,
            },
          ],
        });
      }
      if (q.includes('INSERT INTO te_outbox_events')) {
        return Promise.resolve();
      }
      return Promise.resolve({ rows: [] });
    });

    const engine = new PostgresTradingEngine(pool);
    const trade = await engine.executeTrade('ord1', 5, 100);
    console.log('TRADE:', trade);
    console.log(
      'CALLS:',
      client.query.mock.calls.map((c) => c[0])
    );
    const updateOrderCall = client.query.mock.calls.find((c) => c[0].includes('UPDATE te_orders'));
    if (updateOrderCall) {
      console.log('UPDATE ORDER REJECTION REASON:', updateOrderCall[1][6]);
    }

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
    expect(trade).toBeDefined();

    // Verify outbox was written
    const outboxCalls = client.query.mock.calls.filter((c) =>
      c[0].includes('INSERT INTO te_outbox_events')
    );
    expect(outboxCalls.length).toBeGreaterThan(0);
  });

  it('rollback on error does not leak state', async () => {
    const client = {
      query: vi.fn(),
      release: vi.fn(),
    };
    (pool.connect as any).mockResolvedValue(client);

    client.query.mockImplementation((q) => {
      if (q === 'BEGIN') return Promise.resolve();
      if (q === 'ROLLBACK') return Promise.resolve();
      if (q.includes('te_orders')) throw new Error('DB Error');
      return Promise.resolve({ rows: [] });
    });

    const engine = new PostgresTradingEngine(pool);

    await expect(engine.executeTrade('ord1', 5, 100)).rejects.toThrow('DB Error');
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
