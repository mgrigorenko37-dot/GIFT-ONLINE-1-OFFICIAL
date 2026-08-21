import { getPgPool } from '../marketRepository';
import { isPostgresConfigured } from '../dbConfig';
import { initDbSchema } from '../dbSchema';

export async function runMigrationsCli(): Promise<void> {
  console.log('[Migration Runner] Starting PostgreSQL database migrations...');
  if (!isPostgresConfigured()) {
    console.error('[Migration Runner] FATAL: Neither DATABASE_URL nor SQL_HOST is configured.');
    process.exit(1);
  }

  try {
    const pool = getPgPool();
    const result = await initDbSchema(pool);
    console.log(
      `[Migration Runner] Successfully completed migrations. Applied count: ${result.appliedCount}, Current version: ${result.currentVersion}`
    );
  } catch (err: any) {
    console.error('[Migration Runner] FATAL: Database migration failed:', err?.message || err);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('migrateRunner.ts')) {
  runMigrationsCli().then(() => process.exit(0));
}
