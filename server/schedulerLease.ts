import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';

export class SchedulerLease {
  private pool: Pool;
  private workerId: string;

  constructor(pool: Pool, workerId?: string) {
    this.pool = pool;
    this.workerId = workerId || `worker_${process.pid}_${crypto.randomUUID().substring(0, 8)}`;
  }

  // Use PostgreSQL advisory locks for distributed locking since DDL is restricted here.
  // We use key pairs: 
  // - typeKey (e.g., hash of 'FUNDING')
  // - stringKey (e.g., hash of 'TON_170000000')
  
  private stringToHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Attempts to acquire an advisory lock for a specific job.
   * Returns a client if the lock was acquired, which MUST be used and released.
   * Returns null if the lock is held by another instance.
   */
  async tryAcquireLock(jobType: string, jobKey: string): Promise<PoolClient | null> {
    const typeHash = this.stringToHash(jobType);
    const keyHash = this.stringToHash(jobKey);

    const client = await this.pool.connect();
    try {
      // Use pg_try_advisory_lock to return immediately if locked
      const res = await client.query('SELECT pg_try_advisory_lock($1, $2) as acquired', [typeHash, keyHash]);
      const acquired = res.rows[0].acquired;

      if (!acquired) {
        client.release();
        return null; // Someone else is running this job
      }

      // We own the lock! Return the client so it stays open.
      return client;
    } catch (e) {
      client.release();
      throw e;
    }
  }

  /**
   * Releases an advisory lock using the client that acquired it.
   */
  async releaseLock(client: PoolClient, jobType: string, jobKey: string): Promise<void> {
    const typeHash = this.stringToHash(jobType);
    const keyHash = this.stringToHash(jobKey);
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [typeHash, keyHash]);
    } finally {
      client.release(); // Return client to pool
    }
  }
}
