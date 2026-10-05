BEGIN;

CREATE TABLE IF NOT EXISTS policy_integrity_exceptions (
  exception_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE CASCADE,
  exception_class text NOT NULL,
  severity text NOT NULL DEFAULT 'Error',
  status text NOT NULL DEFAULT 'Open',
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_action text NOT NULL DEFAULT 'Investigate',
  correlation_id text NOT NULL,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  retry_count int NOT NULL DEFAULT 0,
  last_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_integrity_exception_class_ck CHECK (exception_class IN ('MISSING_VERSION','MISSING_RATING','MISSING_FORMS','MISSING_DOCUMENT','MISSING_LEDGER_EVENT','MISSING_CUSTOMER_LINK','INCOMPLETE_SIDE_EFFECT')),
  CONSTRAINT policy_integrity_exception_severity_ck CHECK (severity IN ('Warning','Error','Critical')),
  CONSTRAINT policy_integrity_exception_status_ck CHECK (status IN ('Open','Acknowledged','Resolved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_integrity_active_finding
  ON policy_integrity_exceptions (tenant_id, policy_id, COALESCE(transaction_id, '00000000-0000-0000-0000-000000000000'::uuid), exception_class)
  WHERE status <> 'Resolved';
CREATE INDEX IF NOT EXISTS idx_policy_integrity_queue
  ON policy_integrity_exceptions (tenant_id, status, severity, last_detected_at DESC);

ALTER TABLE policy_integrity_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON policy_integrity_exceptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

INSERT INTO job_definitions (job_code, description, enabled, default_schedule, default_max_attempts, default_timeout_seconds)
VALUES ('policy_integrity_reconciliation', 'Detects policy records with missing versions, ratings, forms, documents, events, customer links, or incomplete side effects.', true, 'interval:6h', 3, 600)
ON CONFLICT (job_code) DO UPDATE SET description = EXCLUDED.description, default_schedule = EXCLUDED.default_schedule, updated_at = now();

INSERT INTO job_schedules (tenant_id, job_code, enabled, schedule_expression, concurrency_key, request_payload, next_run_at)
SELECT tenant_id, 'policy_integrity_reconciliation', true, 'interval:6h', 'policy-integrity:' || tenant_id, '{}'::jsonb, now() FROM tenants
ON CONFLICT (tenant_id, job_code) DO NOTHING;

COMMIT;
