import { spawn } from 'child_process';
import { Pool } from 'pg';
import { SchedulerLease } from './server/schedulerLease';

const pool = new Pool({
  host: process.env.SQL_HOST || 'localhost',
  user: process.env.SQL_USER || 'ai_studio_app_user',
  password: process.env.SQL_PASSWORD || 'password',
  database: process.env.SQL_DB_NAME || 'cloud_sql_development_database',
});

async function main() {
  const ts = Date.now();

  const runWorker = (name: string, delay: number) => {
    return new Promise((resolve) => {
      const proc = spawn(
        'npx',
        ['tsx', 'multi_worker_8_advisory.ts', name, String(ts), String(delay)],
        { env: process.env }
      );
      proc.stdout.on('data', (d) => process.stdout.write(d));
      proc.stderr.on('data', (d) => process.stderr.write(d));
      proc.on('close', (code) => resolve(code));
    });
  };

  console.log('Spawning 3 workers simultaneously...');
  // worker A is slow, worker B is fast, worker C is fast
  await Promise.all([
    runWorker('A_slow', 3000),
    runWorker('B_fast', 100),
    runWorker('C_fast', 100),
  ]);

  console.log('All workers finished.');
  process.exit(0);
}
main();
