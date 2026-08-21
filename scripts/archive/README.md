# Archive / Historical Scripts Directory (`scripts/archive/`)

## Overview

This directory contains **historical one-off patch scripts, DB fix utilities, and legacy test runners** developed during earlier phases of project development.

### Contained Files:

- Database fix utilities (`fix_db.js`, `fix_db2.js`, ..., `fix_db6.js`)
- One-off Python and TypeScript patchers (`patch_order_manager*.py`, `patch_withdrawal*.py`, `patch_invoice*.py`, `patch_tonscanner.py`, `patch_auth.ts`, etc.)
- Historical test runner entrypoints (`test-run.ts`, `run-test.js`, `run_test.js`, `test-run.js`)

---

## Important Rules & Safeguards

1. **NOT Part of Runtime**:
   - None of the files in this directory are part of the active runtime environment or application build.
2. **NOT Executed in CI or Scripts**:
   - No script in `package.json` or `.github/workflows/ci.yml` invokes or references any file inside `scripts/archive/`.
3. **DO NOT RUN ON PRODUCTION**:
   - **CRITICAL**: These scripts must **NEVER** be executed against a production PostgreSQL database or live environment. They contain hardcoded ad-hoc modifications and unvalidated schema manipulations that can cause data corruption, race conditions, or state desynchronization.
4. **Git History Verification**:
   - Before referencing or analyzing any script in this directory, check `git history` to understand the historical context in which it was created.
5. **Single Source of Truth**:
   - The canonical and active source of truth for the application architecture consists of:
     - Express Server & Financial Logic: `/server/` (`server.ts`, `server/trading/orderManager.ts`, `server/withdrawalWorker.ts`, etc.)
     - React Frontend: `/src/`
     - Database Schemas & Migrations: `/server/dbSchema.ts` & `/server/db/migrateRunner.ts`
     - npm Scripts: Defined in `/package.json`
6. **Database Migration Standard**:
   - Any modifications to the database schema or data structures **MUST** pass through the official database migration system (`npm run db:migrate` via `server/db/migrateRunner.ts`), ensuring ACID transaction safety and idempotent execution.
