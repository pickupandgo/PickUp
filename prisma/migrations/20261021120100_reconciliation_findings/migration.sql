-- Reconciliation runs and findings (payment flow Phase 7).
--
--   reconciliation_runs. One row per run of a reconciliation job: COLLECTION_RECOVERY (re-reads
--   stuck online collections from Razorpay and applies what Razorpay reports through the
--   existing collection finalizer) or RECONCILIATION (database and read-only provider checks).
--   At most one RUNNING run per job (partial unique index); a run that outlives its lease is
--   closed as ABANDONED by the next one. A finished run never changes.
--
--   reconciliation_findings. Every mismatch a run detects, recorded and kept for an admin.
--   Nothing is fixed silently: a finding moves money nowhere, and only an admin resolves one,
--   with a note. The same condition seen again only counts another sighting (one OPEN finding per
--   fingerprint). A condition no longer seen by a complete run is marked cleared, never removed.
--   A resolved finding is not reopened while its condition stays; if the condition clears and
--   comes back, it is a new finding. The identity and the first sighting never change.
--
--   Neither table can be deleted from or truncated, by any role.
--
-- No existing row changes.
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- ---------------------------------------------------------------------------------------------
-- reconciliation_runs
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job" VARCHAR(40) NOT NULL,
    "triggered_by" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "requested_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "lease_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- One run of each job at a time.
CREATE UNIQUE INDEX "uq_reconciliation_runs_running" ON "reconciliation_runs"("job")
    WHERE status = 'RUNNING';
CREATE INDEX "idx_reconciliation_runs_job_started" ON "reconciliation_runs"("job", "started_at" DESC);

ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "reconciliation_runs"
    ADD CONSTRAINT "reconciliation_runs_job_valid"
        CHECK (job IN ('COLLECTION_RECOVERY', 'RECONCILIATION')),
    ADD CONSTRAINT "reconciliation_runs_triggered_by_valid"
        CHECK (triggered_by IN ('SCHEDULE', 'ADMIN')),
    ADD CONSTRAINT "reconciliation_runs_status_valid"
        CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'ABANDONED')),
    -- An admin's run names the admin; a scheduled run names nobody.
    ADD CONSTRAINT "reconciliation_runs_requester"
        CHECK ((triggered_by = 'ADMIN') = (requested_by_user_id IS NOT NULL)),
    ADD CONSTRAINT "reconciliation_runs_finished"
        CHECK ((status = 'RUNNING') = (finished_at IS NULL)),
    ADD CONSTRAINT "reconciliation_runs_scope_object" CHECK (jsonb_typeof(scope) = 'object'),
    ADD CONSTRAINT "reconciliation_runs_summary_object" CHECK (jsonb_typeof(summary) = 'object');

CREATE OR REPLACE FUNCTION guard_reconciliation_run_insert() RETURNS trigger AS $$
BEGIN
    IF NEW.status <> 'RUNNING' OR NEW.finished_at IS NOT NULL THEN
        RAISE EXCEPTION 'A reconciliation run is recorded RUNNING when it starts'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.requested_by_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM users u
         WHERE u.id = NEW.requested_by_user_id AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Only an active admin requests a reconciliation run'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A run records its outcome once; its job, trigger, scope, requester and start never change.
CREATE OR REPLACE FUNCTION guard_reconciliation_run_update() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.job <> OLD.job
       OR NEW.triggered_by <> OLD.triggered_by
       OR NEW.scope <> OLD.scope
       OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
       OR NEW.started_at <> OLD.started_at
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'A reconciliation run''s job, trigger, scope, requester and start are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'RUNNING' THEN
        RAISE EXCEPTION 'A finished reconciliation run (%) is immutable', OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.lease_expires_at < OLD.lease_expires_at THEN
        RAISE EXCEPTION 'A reconciliation run''s lease only moves forward'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconciliation_runs_insert_guard BEFORE INSERT ON "reconciliation_runs"
    FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_run_insert();
CREATE TRIGGER trg_reconciliation_runs_guard BEFORE UPDATE ON "reconciliation_runs"
    FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_run_update();
CREATE TRIGGER trg_reconciliation_runs_no_delete BEFORE DELETE ON "reconciliation_runs"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_reconciliation_runs_no_truncate BEFORE TRUNCATE ON "reconciliation_runs"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();

-- ---------------------------------------------------------------------------------------------
-- reconciliation_findings
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "reconciliation_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" VARCHAR(40) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "fingerprint" VARCHAR(300) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "entity_type" VARCHAR(40),
    "entity_id" VARCHAR(150),
    "booking_id" UUID,
    "driver_id" UUID,
    "provider_ref" VARCHAR(150),
    "internal_state" VARCHAR(60),
    "provider_state" VARCHAR(60),
    "internal_amount_paise" BIGINT,
    "provider_amount_paise" BIGINT,
    "detail" VARCHAR(500),
    "refs" JSONB NOT NULL DEFAULT '{}',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "first_run_id" UUID,
    "last_run_id" UUID,
    "cleared_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    "resolution_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_findings_pkey" PRIMARY KEY ("id")
);

-- One OPEN finding per condition; sightings of it are counted on that row.
CREATE UNIQUE INDEX "uq_reconciliation_findings_open" ON "reconciliation_findings"("fingerprint")
    WHERE status = 'OPEN';
CREATE INDEX "idx_reconciliation_findings_fingerprint" ON "reconciliation_findings"("fingerprint");
CREATE INDEX "idx_reconciliation_findings_status" ON "reconciliation_findings"("status", "category", "last_seen_at" DESC);
CREATE INDEX "idx_reconciliation_findings_booking" ON "reconciliation_findings"("booking_id")
    WHERE booking_id IS NOT NULL;

ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_first_run_id_fkey" FOREIGN KEY ("first_run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_last_run_id_fkey" FOREIGN KEY ("last_run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "reconciliation_findings"
    ADD CONSTRAINT "reconciliation_findings_category_valid"
        CHECK (category IN ('PROVIDER_PAID_INTERNAL_PENDING', 'INTERNAL_PAID_PROVIDER_NOT_PAID',
                            'EARNING_SOURCE_MISMATCH', 'SETTLEMENT_MISMATCH', 'PAYOUT_MISMATCH',
                            'REFUND_MISMATCH', 'WALLET_MISMATCH', 'STALE_PENDING',
                            'DUPLICATE_PROVIDER_EVENT', 'PROVIDER_EVENT_ANOMALY')),
    ADD CONSTRAINT "reconciliation_findings_kind_format" CHECK (kind ~ '^[A-Z][A-Z0-9_]{1,59}$'),
    ADD CONSTRAINT "reconciliation_findings_severity_valid"
        CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    ADD CONSTRAINT "reconciliation_findings_source_valid"
        CHECK (source IN ('DATABASE', 'PROVIDER', 'RECOVERY')),
    ADD CONSTRAINT "reconciliation_findings_status_valid" CHECK (status IN ('OPEN', 'RESOLVED')),
    ADD CONSTRAINT "reconciliation_findings_fingerprint_not_blank"
        CHECK (length(btrim(fingerprint)) > 0),
    ADD CONSTRAINT "reconciliation_findings_occurrences_positive" CHECK (occurrences >= 1),
    ADD CONSTRAINT "reconciliation_findings_seen_order" CHECK (last_seen_at >= first_seen_at),
    ADD CONSTRAINT "reconciliation_findings_refs_object" CHECK (jsonb_typeof(refs) = 'object'),
    -- Resolved means an admin, a time and a note, together; open means none of them.
    ADD CONSTRAINT "reconciliation_findings_resolution"
        CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL)
               AND (status = 'RESOLVED') = (resolved_by_user_id IS NOT NULL)
               AND (status = 'RESOLVED') = (resolution_note IS NOT NULL)
               AND (resolution_note IS NULL OR length(btrim(resolution_note)) >= 10));

CREATE OR REPLACE FUNCTION guard_reconciliation_finding_insert() RETURNS trigger AS $$
BEGIN
    IF NEW.status <> 'OPEN' OR NEW.cleared_at IS NOT NULL OR NEW.occurrences <> 1
       OR NEW.last_run_id IS DISTINCT FROM NEW.first_run_id THEN
        RAISE EXCEPTION 'A finding is recorded OPEN, at its first sighting'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- What a finding is and when it was first seen never change. Sightings only move forward. Only
-- an active admin resolves it, once; afterwards only later sightings are counted on it.
CREATE OR REPLACE FUNCTION guard_reconciliation_finding_update() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.category <> OLD.category
       OR NEW.kind <> OLD.kind
       OR NEW.severity <> OLD.severity
       OR NEW.source <> OLD.source
       OR NEW.fingerprint <> OLD.fingerprint
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
       OR NEW.provider_ref IS DISTINCT FROM OLD.provider_ref
       OR NEW.first_seen_at <> OLD.first_seen_at
       OR NEW.first_run_id IS DISTINCT FROM OLD.first_run_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'A finding''s identity and first sighting are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.occurrences < OLD.occurrences OR NEW.last_seen_at < OLD.last_seen_at THEN
        RAISE EXCEPTION 'A finding''s sightings only move forward'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'RESOLVED' THEN
        IF NEW.status <> 'RESOLVED'
           OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
           OR NEW.resolved_by_user_id IS DISTINCT FROM OLD.resolved_by_user_id
           OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note
           OR NEW.detail IS DISTINCT FROM OLD.detail
           OR NEW.internal_state IS DISTINCT FROM OLD.internal_state
           OR NEW.provider_state IS DISTINCT FROM OLD.provider_state
           OR NEW.internal_amount_paise IS DISTINCT FROM OLD.internal_amount_paise
           OR NEW.provider_amount_paise IS DISTINCT FROM OLD.provider_amount_paise
           OR NEW.refs IS DISTINCT FROM OLD.refs
           OR (OLD.cleared_at IS NOT NULL AND NEW.cleared_at IS DISTINCT FROM OLD.cleared_at) THEN
            RAISE EXCEPTION 'A resolved finding is never reopened or changed; only later sightings are counted'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF NEW.status = 'RESOLVED' AND NOT EXISTS (
        SELECT 1 FROM users u
         WHERE u.id = NEW.resolved_by_user_id AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Only an active admin resolves a finding'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconciliation_findings_insert_guard BEFORE INSERT ON "reconciliation_findings"
    FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_finding_insert();
CREATE TRIGGER trg_reconciliation_findings_guard BEFORE UPDATE ON "reconciliation_findings"
    FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_finding_update();
CREATE TRIGGER trg_reconciliation_findings_no_delete BEFORE DELETE ON "reconciliation_findings"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_reconciliation_findings_no_truncate BEFORE TRUNCATE ON "reconciliation_findings"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();
