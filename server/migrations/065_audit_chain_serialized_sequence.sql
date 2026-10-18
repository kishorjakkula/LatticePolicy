BEGIN;

-- Defaults run before BEFORE INSERT triggers. Allocate chain positions only
-- after taking the same lock used to select the predecessor, so a waiting
-- insert cannot sort before an insert which committed while it was waiting.
LOCK TABLE llm_release_audit, submission_events IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION audit_chain_append() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE previous text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || TG_TABLE_NAME), hashtext(NEW.tenant_id));
  NEW.chain_seq := nextval(pg_get_serial_sequence(format('%I.%I', TG_TABLE_SCHEMA, TG_TABLE_NAME), 'chain_seq'));
  NEW.created_at := clock_timestamp();
  EXECUTE format('SELECT entry_hash FROM %I WHERE tenant_id = $1 ORDER BY chain_seq DESC LIMIT 1', TG_TABLE_NAME)
    INTO previous USING NEW.tenant_id;
  NEW.prev_hash := previous;
  NEW.entry_hash := audit_chain_hash(previous, audit_chain_payload(to_jsonb(NEW), NEW.created_at));
  RETURN NEW;
END $$;

-- The sequences remain owned by their columns. The trigger assigns them even
-- if a caller supplies chain_seq; gaps on rolled-back transactions are valid.
ALTER TABLE llm_release_audit ALTER COLUMN chain_seq DROP DEFAULT;
ALTER TABLE submission_events ALTER COLUMN chain_seq DROP DEFAULT;

COMMIT;
