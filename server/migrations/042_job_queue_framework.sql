BEGIN;

-- Platform-level registry of supported job types. Global because job
-- capabilities are platform-level; per-tenant enablement lives in
-- job_schedules.
CREATE TABLE IF NOT EXISTS job_definitions (
  job_code text PRIMARY KEY,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  default_schedule text,
  default_max_attempts int NOT NULL DEFAULT 5,
  default_timeout_seconds int NOT NULL DEFAULT 300,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant-scoped schedule and operational controls for a job.
CREATE TABLE IF NOT EXISTS job_schedules (
  schedule_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  job_code text NOT NULL REFERENCES job_definitions(job_code) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  schedule_expression text,
  concurrency_key text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_code)
);

CREATE INDEX IF NOT EXISTS idx_job_schedules_due
  ON job_schedules (enabled, next_run_at);

-- Durable run history and checkpoint state.
CREATE TABLE IF NOT EXISTS job_runs (
  run_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  job_code text NOT NULL REFERENCES job_definitions(job_code) ON DELETE CASCADE,
  schedule_id uuid REFERENCES job_schedules(schedule_id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'Queued',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  locked_by text,
  locked_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_runs_status_ck CHECK (
    status IN ('Queued', 'Running', 'Succeeded', 'Retry', 'DeadLettered', 'Cancelled')
  ),
  CONSTRAINT job_runs_idempotency_uq UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_job_runs_dispatch
  ON job_runs (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_job_runs_tenant_history
  ON job_runs (tenant_id, job_code, created_at DESC);

-- Append-only operational log for audit/debug.
CREATE TABLE IF NOT EXISTS job_run_events (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES job_runs(run_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_run_events_run
  ON job_run_events (run_id, created_at);

CREATE OR REPLACE FUNCTION set_job_queue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_definitions_updated_at ON job_definitions;
CREATE TRIGGER trg_job_definitions_updated_at
BEFORE UPDATE ON job_definitions
FOR EACH ROW
EXECUTE FUNCTION set_job_queue_updated_at();

DROP TRIGGER IF EXISTS trg_job_schedules_updated_at ON job_schedules;
CREATE TRIGGER trg_job_schedules_updated_at
BEFORE UPDATE ON job_schedules
FOR EACH ROW
EXECUTE FUNCTION set_job_queue_updated_at();

DROP TRIGGER IF EXISTS trg_job_runs_updated_at ON job_runs;
CREATE TRIGGER trg_job_runs_updated_at
BEFORE UPDATE ON job_runs
FOR EACH ROW
EXECUTE FUNCTION set_job_queue_updated_at();

-- job_definitions is intentionally global (no tenant_id), so no RLS there.
ALTER TABLE job_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_run_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['job_schedules', 'job_runs', 'job_run_events']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = current_schema()
        AND tablename = tbl
        AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
        tbl
      );
    END IF;
  END LOOP;
END
$$;

-- First job type: retry async outbox delivery. Enabled by default so the
-- worker recognizes it as soon as JOB_WORKER_ENABLED is turned on.
INSERT INTO job_definitions (job_code, description, enabled, default_schedule, default_max_attempts, default_timeout_seconds)
VALUES (
  'async_outbox_delivery_retry',
  'Claims due async_message_outbox rows and dispatches them through the configured delivery adapter.',
  true,
  'interval:60s',
  5,
  120
)
ON CONFLICT (job_code) DO NOTHING;

COMMIT;
