BEGIN;

CREATE TABLE IF NOT EXISTS notification_templates (
  template_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  template_code text NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL DEFAULT 'EMAIL',
  product_code text,
  transaction_type text,
  locale text NOT NULL DEFAULT 'en-US',
  subject_template text NOT NULL,
  body_template text NOT NULL,
  visibility text[] NOT NULL DEFAULT ARRAY['customer']::text[],
  active boolean NOT NULL DEFAULT true,
  effective_date date,
  expiration_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_code)
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_lookup
  ON notification_templates (tenant_id, event_type, channel, product_code, active);

CREATE TABLE IF NOT EXISTS notification_intents (
  notification_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  event_type text NOT NULL,
  channel text NOT NULL DEFAULT 'EMAIL',
  recipient jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_code text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'Pending',
  provider text,
  provider_message_id text,
  correlation_id text,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_intents_status_ck CHECK (status IN ('Pending', 'Queued', 'Sent', 'Failed', 'Suppressed'))
);

CREATE INDEX IF NOT EXISTS idx_notification_intents_policy
  ON notification_intents (tenant_id, policy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_intents_status
  ON notification_intents (tenant_id, status, next_attempt_at);

CREATE OR REPLACE FUNCTION set_notification_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
BEFORE UPDATE ON notification_templates
FOR EACH ROW
EXECUTE FUNCTION set_notification_updated_at();

DROP TRIGGER IF EXISTS trg_notification_intents_updated_at ON notification_intents;
CREATE TRIGGER trg_notification_intents_updated_at
BEFORE UPDATE ON notification_intents
FOR EACH ROW
EXECUTE FUNCTION set_notification_updated_at();

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_intents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['notification_templates', 'notification_intents']
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

COMMIT;
