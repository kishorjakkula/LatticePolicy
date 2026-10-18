BEGIN;

-- AI governance hardening.
--
-- 1. Audit logs for AI work (submission intake) and model releases are
--    append-only and hash-chained per carrier, and every entry says whether a
--    person, the AI, release automation, or the system acted.
-- 2. Releases can be revoked; validator, production approver and the
--    registering identity must be three different people (four-eyes).
-- 3. Carriers can raise, never lower, the release gates.
-- 4. Release automation signs in with a scoped, expiring service credential.

-- ── Tamper-evident, append-only audit chain ──────────────────────────────────

-- The hashed form of an audit row: every column except the chain hashes, with
-- created_at as epoch microseconds so the text never depends on the session
-- time zone.
CREATE OR REPLACE FUNCTION audit_chain_payload(entry jsonb, created timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((entry - 'prev_hash' - 'entry_hash')
    || jsonb_build_object('created_at', (extract(epoch FROM created) * 1000000)::bigint))::text
$$;

CREATE OR REPLACE FUNCTION audit_chain_hash(previous text, payload text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(coalesce(previous, 'genesis') || '|' || payload, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_chain_append() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE previous text;
BEGIN
  -- One writer per carrier chain at a time, so entries never fork.
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || TG_TABLE_NAME), hashtext(NEW.tenant_id));
  NEW.created_at := clock_timestamp();
  EXECUTE format('SELECT entry_hash FROM %I WHERE tenant_id = $1 ORDER BY chain_seq DESC LIMIT 1', TG_TABLE_NAME)
    INTO previous USING NEW.tenant_id;
  NEW.prev_hash := previous;
  NEW.entry_hash := audit_chain_hash(previous, audit_chain_payload(to_jsonb(NEW), NEW.created_at));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Removing a whole carrier (offboarding) is the only deletion allowed, and
  -- it must be requested explicitly in that transaction.
  IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'tenant-offboarding' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: % rows cannot be changed or deleted', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- Returns the chain_seq of the first entry whose hash does not match, or NULL
-- when the carrier's chain is intact.
CREATE OR REPLACE FUNCTION audit_chain_first_break(tbl text, tenant text) RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE r record; previous text := NULL; payload text;
BEGIN
  IF tbl NOT IN ('llm_release_audit', 'submission_events') THEN
    RAISE EXCEPTION 'Unknown audit table %', tbl;
  END IF;
  FOR r IN EXECUTE format('SELECT * FROM %I WHERE tenant_id = $1 ORDER BY chain_seq', tbl) USING tenant LOOP
    payload := audit_chain_payload(to_jsonb(r), r.created_at);
    IF r.prev_hash IS DISTINCT FROM previous OR r.entry_hash IS DISTINCT FROM audit_chain_hash(previous, payload) THEN
      RETURN r.chain_seq;
    END IF;
    previous := r.entry_hash;
  END LOOP;
  RETURN NULL;
END $$;

-- ── Model release audit ──────────────────────────────────────────────────────

-- Governance events that are not about one release (role grants, policy,
-- service credentials) have no release; system events have no person.
ALTER TABLE llm_release_audit ALTER COLUMN release_id DROP NOT NULL;
ALTER TABLE llm_release_audit ALTER COLUMN actor_id DROP NOT NULL;
-- user: a signed-in person. automation: the release pipeline's service
-- identity. system: LatticePolicy itself.
ALTER TABLE llm_release_audit ADD COLUMN actor_type text NOT NULL DEFAULT 'user'
  CHECK (actor_type IN ('user', 'automation', 'system'));
-- Roles the actor held when acting, so later role changes cannot rewrite history.
ALTER TABLE llm_release_audit ADD COLUMN actor_roles text[] NOT NULL DEFAULT '{}';
-- The account a governance event is about. No foreign key: the history outlives the account.
ALTER TABLE llm_release_audit ADD COLUMN subject_user_id uuid;
ALTER TABLE llm_release_audit ADD COLUMN request_id text;
ALTER TABLE llm_release_audit ADD CONSTRAINT llm_release_audit_actor_present
  CHECK (actor_type = 'system' OR actor_id IS NOT NULL);
UPDATE llm_release_audit SET actor_type = 'automation' WHERE action = 'CANDIDATE_READY';
-- Segregation of duties, enforced by the database: automation only registers
-- candidates, and only a person tests, approves, renews, rejects or revokes.
ALTER TABLE llm_release_audit ADD CONSTRAINT llm_release_audit_segregation CHECK (
  (actor_type <> 'automation' OR action = 'CANDIDATE_READY')
  AND (action NOT IN ('start-validation','record-validation','authorize-production','renew-authorization','reject','revoke') OR actor_type = 'user')
);

-- ── Submission intake audit ──────────────────────────────────────────────────

ALTER TABLE submission_events ADD CONSTRAINT submission_events_actor_type
  CHECK (actor_type IN ('ai', 'user', 'system'));
-- The AI only reads documents and drafts values. Confirming, editing,
-- choosing the customer, approving and declining are a person's actions.
ALTER TABLE submission_events ADD CONSTRAINT submission_events_segregation CHECK (
  (actor_type <> 'ai' OR action IN ('drafted', 'reading_failed'))
  AND (action NOT IN ('received','reading_requested','manual_review_started','value_confirmed','value_edited','value_unconfirmed','high_confidence_confirmed','customer_choice','approved','declined') OR actor_type = 'user')
  AND (actor_type = 'system' OR actor IS NOT NULL)
);
ALTER TABLE submission_events ADD COLUMN request_id text;

-- Chain columns, numbered in the order events happened, then hashed.
DO $$ DECLARE tbl text; r record; previous text; current_tenant text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['llm_release_audit', 'submission_events'] LOOP
    EXECUTE format('CREATE SEQUENCE %I', tbl || '_chain_seq');
    EXECUTE format('ALTER TABLE %I ADD COLUMN chain_seq bigint, ADD COLUMN prev_hash text, ADD COLUMN entry_hash text', tbl);
    EXECUTE format('UPDATE %I a SET chain_seq = o.n FROM (SELECT event_id, row_number() OVER (ORDER BY created_at, event_id) AS n FROM %I) o WHERE o.event_id = a.event_id', tbl, tbl);
    EXECUTE format('SELECT setval(%L, coalesce((SELECT max(chain_seq) FROM %I), 0) + 1, false)', tbl || '_chain_seq', tbl);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN chain_seq SET DEFAULT nextval(%L), ALTER COLUMN chain_seq SET NOT NULL', tbl, tbl || '_chain_seq');
    EXECUTE format('ALTER SEQUENCE %I OWNED BY %I.chain_seq', tbl || '_chain_seq', tbl);
    previous := NULL; current_tenant := NULL;
    FOR r IN EXECUTE format('SELECT * FROM %I ORDER BY tenant_id, chain_seq', tbl) LOOP
      IF current_tenant IS DISTINCT FROM r.tenant_id THEN previous := NULL; current_tenant := r.tenant_id; END IF;
      EXECUTE format('UPDATE %I SET prev_hash = $1, entry_hash = $2 WHERE event_id = $3', tbl)
        USING previous, audit_chain_hash(previous, audit_chain_payload(to_jsonb(r) - 'prev_hash' - 'entry_hash', r.created_at)), r.event_id;
      EXECUTE format('SELECT entry_hash FROM %I WHERE event_id = $1', tbl) INTO previous USING r.event_id;
    END LOOP;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN entry_hash SET NOT NULL', tbl);
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (tenant_id, chain_seq)', tbl || '_chain_idx', tbl);
    EXECUTE format('CREATE TRIGGER audit_chain BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION audit_chain_append()', tbl);
    EXECUTE format('CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_append_only()', tbl);
  END LOOP;
END $$;

-- ── Releases: revocation, evidence, four-eyes ────────────────────────────────

ALTER TABLE llm_releases DROP CONSTRAINT llm_releases_status_check;
ALTER TABLE llm_releases ADD CONSTRAINT llm_releases_status_check
  CHECK (status IN ('READY_FOR_VALIDATION','IN_VALIDATION','VALIDATED','REJECTED','PRODUCTION_AUTHORIZED','REVOKED'));
-- The held-out evaluation report and the lower-environment test report, kept
-- so the recorded hashes and metrics can be re-checked at any time.
ALTER TABLE llm_releases ADD COLUMN evaluation_report jsonb;
ALTER TABLE llm_releases ADD COLUMN validation_report jsonb;
-- The carrier gates in force when the release was registered.
ALTER TABLE llm_releases ADD COLUMN gate_policy jsonb;
ALTER TABLE llm_releases ADD COLUMN revoked_by uuid REFERENCES users(user_id);
ALTER TABLE llm_releases ADD COLUMN revoked_at timestamptz;
ALTER TABLE llm_releases ADD COLUMN revocation_reason text;
-- NOT VALID: enforced for every new write; rows written before this rule stay readable.
ALTER TABLE llm_releases ADD CONSTRAINT llm_releases_four_eyes CHECK (
  (validated_by IS NULL OR validated_by <> created_by)
  AND (approved_by IS NULL OR (approved_by <> created_by AND approved_by IS DISTINCT FROM validated_by))
) NOT VALID;
ALTER TABLE llm_releases ADD CONSTRAINT llm_releases_revocation CHECK (
  status <> 'REVOKED' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
) NOT VALID;

-- ── Carrier release gates (never below the platform floor) ───────────────────

CREATE TABLE llm_release_policies (
  tenant_id text PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  min_sample_count integer NOT NULL DEFAULT 20 CHECK (min_sample_count BETWEEN 20 AND 100000),
  min_field_accuracy numeric(5,4) NOT NULL DEFAULT 0.95 CHECK (min_field_accuracy BETWEEN 0.95 AND 1),
  min_evidence_accuracy numeric(5,4) NOT NULL DEFAULT 0.98 CHECK (min_evidence_accuracy BETWEEN 0.98 AND 1),
  -- Signed authorizations carry this expiry.
  authorization_days integer NOT NULL DEFAULT 7 CHECK (authorization_days BETWEEN 1 AND 30),
  -- A newly granted technical admin waits this long before approving.
  role_cooldown_hours integer NOT NULL DEFAULT 24 CHECK (role_cooldown_hours BETWEEN 24 AND 720),
  updated_by uuid REFERENCES users(user_id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Release automation service credentials ───────────────────────────────────

CREATE TABLE llm_automation_credentials (
  credential_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  label text NOT NULL,
  -- Only the SHA-256 of the secret is stored; the secret is shown once.
  secret_sha256 text NOT NULL CHECK (secret_sha256 ~ '^[a-f0-9]{64}$'),
  allowed_cidrs cidr[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_by uuid REFERENCES users(user_id),
  revoked_at timestamptz,
  CHECK (created_by <> user_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days')
);
CREATE INDEX llm_automation_credentials_tenant ON llm_automation_credentials(tenant_id, created_at DESC);

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['llm_release_policies','llm_automation_credentials'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', tbl);
  END LOOP;
END $$;

-- ── AI audit permission ──────────────────────────────────────────────────────

INSERT INTO rbac_permissions(permission_code,scope,resource_key,action_key,label,description,sort_order) VALUES
 ('menu.admin.ai_audit.view','menu','admin.ai_audit','view','Admin Menu: AI Audit','View the AI and person activity audit',805),
 ('page.admin.ai_audit.view','page','admin.ai_audit','view','Page: AI Audit','Review what the AI did and what people did',806),
 ('ai.audit.read','api','ai.audit','read','AI Audit: Read','Read the AI governance audit trail and verify its integrity',807)
ON CONFLICT DO NOTHING;
INSERT INTO rbac_role_permissions(tenant_id,role_code,permission_code,created_by)
 SELECT r.tenant_id,r.role_code,p.code,'migration:064' FROM rbac_roles r CROSS JOIN (VALUES
  ('menu.admin.ai_audit.view'),('page.admin.ai_audit.view'),('ai.audit.read')) p(code)
 WHERE r.role_code IN ('admin','carrier_technical_admin')
   AND EXISTS (SELECT 1 FROM rbac_role_permissions g WHERE g.tenant_id = r.tenant_id AND g.role_code = r.role_code)
ON CONFLICT DO NOTHING;

COMMIT;
