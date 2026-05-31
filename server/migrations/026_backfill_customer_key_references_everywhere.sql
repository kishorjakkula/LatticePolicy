BEGIN;

-- Remove tenant-coded customer key references that may remain in historical/audit payloads.
-- Example transform: CUST-SAMPLECARRIE-2026-000001 -> CUST-2026-000001
DO $$
DECLARE
  key_pattern constant text := 'CUST-([A-Z][A-Z0-9]*)-([0-9]{4})-([0-9]{1,8})';
  key_replace constant text := 'CUST-\2-\3';
BEGIN
  UPDATE customer_audit_events
     SET before_json = regexp_replace(before_json::text, key_pattern, key_replace, 'g')::jsonb
   WHERE coalesce(before_json, '{}'::jsonb)::text ~ key_pattern;

  UPDATE customer_audit_events
     SET after_json = regexp_replace(after_json::text, key_pattern, key_replace, 'g')::jsonb
   WHERE coalesce(after_json, '{}'::jsonb)::text ~ key_pattern;

  UPDATE customer_audit_events
     SET field_diffs = regexp_replace(field_diffs::text, key_pattern, key_replace, 'g')::jsonb
   WHERE coalesce(field_diffs, '[]'::jsonb)::text ~ key_pattern;

  UPDATE customer_approvals
     SET payload = regexp_replace(payload::text, key_pattern, key_replace, 'g')::jsonb
   WHERE coalesce(payload, '{}'::jsonb)::text ~ key_pattern;

  UPDATE policy_customer_links
     SET metadata = regexp_replace(metadata::text, key_pattern, key_replace, 'g')::jsonb,
         updated_at = now()
   WHERE coalesce(metadata, '{}'::jsonb)::text ~ key_pattern;

  UPDATE policies
     SET metadata = regexp_replace(metadata::text, key_pattern, key_replace, 'g')::jsonb,
         risk_summary = regexp_replace(risk_summary::text, key_pattern, key_replace, 'g')::jsonb,
         updated_at = now()
   WHERE coalesce(metadata, '{}'::jsonb)::text ~ key_pattern
      OR coalesce(risk_summary, '{}'::jsonb)::text ~ key_pattern;

  UPDATE quotes
     SET payload = regexp_replace(payload::text, key_pattern, key_replace, 'g')::jsonb,
         updated_at = now()
   WHERE coalesce(payload, '{}'::jsonb)::text ~ key_pattern;

  UPDATE policy_transactions
     SET snapshot = regexp_replace(snapshot::text, key_pattern, key_replace, 'g')::jsonb,
         metadata = regexp_replace(metadata::text, key_pattern, key_replace, 'g')::jsonb,
         updated_at = now()
   WHERE coalesce(snapshot, '{}'::jsonb)::text ~ key_pattern
      OR coalesce(metadata, '{}'::jsonb)::text ~ key_pattern;

  UPDATE policy_versions
     SET payload = regexp_replace(payload::text, key_pattern, key_replace, 'g')::jsonb
   WHERE coalesce(payload, '{}'::jsonb)::text ~ key_pattern;
END $$;

COMMIT;
