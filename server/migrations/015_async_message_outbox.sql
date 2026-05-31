BEGIN;

CREATE TABLE IF NOT EXISTS async_message_outbox (
  message_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  source_table text NOT NULL DEFAULT 'ledger_events',
  source_id uuid NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT async_message_outbox_status_ck CHECK (status IN ('Pending', 'Processing', 'Retry', 'Sent', 'Failed')),
  CONSTRAINT async_message_outbox_source_uq UNIQUE (tenant_id, source_table, source_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_async_message_outbox_dispatch
  ON async_message_outbox(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_async_message_outbox_tenant_dispatch
  ON async_message_outbox(tenant_id, status, next_attempt_at);

CREATE OR REPLACE FUNCTION set_async_message_outbox_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_async_message_outbox_updated_at ON async_message_outbox;
CREATE TRIGGER trg_async_message_outbox_updated_at
BEFORE UPDATE ON async_message_outbox
FOR EACH ROW
EXECUTE FUNCTION set_async_message_outbox_updated_at();

CREATE OR REPLACE FUNCTION enqueue_async_message_from_ledger_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sanitized_event text;
BEGIN
  sanitized_event := lower(regexp_replace(coalesce(NEW.event, 'event'), '[^a-zA-Z0-9_]+', '_', 'g'));

  INSERT INTO async_message_outbox (
    tenant_id,
    source_table,
    source_id,
    topic,
    payload
  )
  VALUES (
    NEW.tenant_id,
    'ledger_events',
    NEW.event_id,
    format('ledger.%s', sanitized_event),
    jsonb_build_object(
      'eventId', NEW.event_id,
      'tenantId', NEW.tenant_id,
      'entityType', NEW.entity_type,
      'entityId', NEW.entity_id,
      'event', NEW.event,
      'fromState', NEW.from_state,
      'toState', NEW.to_state,
      'occurredAt', NEW.occurred_at,
      'actor', NEW.actor,
      'payload', coalesce(NEW.payload, '{}'::jsonb)
    )
  )
  ON CONFLICT (tenant_id, source_table, source_id, topic) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_events_enqueue_async_message ON ledger_events;
CREATE TRIGGER trg_ledger_events_enqueue_async_message
AFTER INSERT ON ledger_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_async_message_from_ledger_event();

ALTER TABLE async_message_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'async_message_outbox'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON async_message_outbox USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END
$$;

COMMIT;
