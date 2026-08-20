import { Pool } from 'pg';
import { Server } from 'socket.io';

export async function processTradingOutbox(pool: Pool, io: Server) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch pending events with FOR UPDATE SKIP LOCKED to allow concurrent workers
    const res = await client.query(`
      SELECT * FROM te_outbox_events 
      WHERE status = 'pending' 
      ORDER BY id ASC 
      LIMIT 100 
      FOR UPDATE SKIP LOCKED
    `);

    if (res.rows.length === 0) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      return;
    }

    for (const row of res.rows) {
      const { id, event_type, user_id, payload } = row;
      const data = JSON.parse(payload);

      // Publish event
      if (event_type === 'tradeExecuted') {
        io.to(user_id).emit('tradeExecuted', data);
      } else if (event_type === 'orderUpdated') {
        io.to(user_id).emit('orderUpdated', data);
      } else if (event_type === 'positionUpdated') {
        io.to(user_id).emit('positionUpdated', data);
      } else if (event_type === 'balanceUpdated') {
        io.to(user_id).emit('balanceUpdated', data.balance);
      } else if (event_type === 'historyUpdated') {
        io.to(user_id).emit('historyUpdated', data.trade);
      } else if (event_type === 'orderCancelled') {
        io.to(user_id).emit('orderUpdated', data);
      }

      // Mark as published
      await client.query(
        `UPDATE te_outbox_events SET status = 'published', published_at = $1 WHERE id = $2`,
        [Date.now(), id]
      );
    }

    await client.query('COMMIT');
  } catch (e: any) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    if (e?.code === '42P01' || e?.message?.includes('does not exist')) {
      return;
    }
    console.error('Error processing trading outbox', e);
  } finally {
    client.release();
  }
}

let outboxInterval: NodeJS.Timeout | null = null;

export function startTradingOutboxWorker(pool: Pool, io: Server) {
  if (outboxInterval) return;
  outboxInterval = setInterval(() => {
    processTradingOutbox(pool, io).catch(console.error);
  }, 1000);
}

export function stopTradingOutboxWorker() {
  if (outboxInterval) {
    clearInterval(outboxInterval);
    outboxInterval = null;
  }
}
