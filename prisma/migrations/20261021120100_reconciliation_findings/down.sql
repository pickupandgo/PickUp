-- Manual rollback of 20261021120100_reconciliation_findings. Prisma never runs this file.
-- Run it before 20261021120000_financial_events/down.sql.
--
-- It drops no data: it refuses once any reconciliation run or finding is recorded (they are the
-- record of what was detected and how an admin resolved it). Otherwise it drops both empty
-- tables and their functions and triggers. No financial record changes. Roll the backend back to
-- the previous release at the same time.
--
-- Then remove the migration's row from _prisma_migrations, so `prisma migrate deploy` can apply
-- it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261021120100_reconciliation_findings';
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM reconciliation_findings) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261021120100: reconciliation findings are recorded';
    END IF;
    IF EXISTS (SELECT 1 FROM reconciliation_runs) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261021120100: reconciliation runs are recorded';
    END IF;
END;
$$;

DROP TABLE "reconciliation_findings";
DROP TABLE "reconciliation_runs";
DROP FUNCTION IF EXISTS guard_reconciliation_finding_insert();
DROP FUNCTION IF EXISTS guard_reconciliation_finding_update();
DROP FUNCTION IF EXISTS guard_reconciliation_run_insert();
DROP FUNCTION IF EXISTS guard_reconciliation_run_update();
COMMIT;
