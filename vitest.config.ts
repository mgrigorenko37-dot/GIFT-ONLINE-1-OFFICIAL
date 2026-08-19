import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/postgresql_margin_tests.test.ts',
      '**/server/tradingEngineDb.test.ts',
      '**/server/currencyMigration.test.ts',
      '**/server/postgresProductionRulesRequirements.test.ts',
      '**/server/outboxAndProductionRules.test.ts',
    ],
  },
});
