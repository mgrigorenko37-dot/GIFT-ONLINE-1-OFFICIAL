import { Pool } from 'pg';

export async function up(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS te_scheduler_leases (
      job_type VARCHAR(50) NOT NULL,
      job_key VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'running',
      locked_by VARCHAR(100),
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      completed_at BIGINT,
      PRIMARY KEY (job_type, job_key)
    );
  `);
}

export async function down(pool: Pool) {
  await pool.query(`DROP TABLE IF NOT EXISTS te_scheduler_leases`);
}
