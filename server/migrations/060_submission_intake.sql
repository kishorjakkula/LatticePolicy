BEGIN;

-- AI-assisted submission intake.
--
-- A broker submission (email, documents) is read by an extractor, which
-- drafts values for the fields of the product's quote screen. Every drafted
-- value is a proposal: a person confirms or corrects each one, then approves
-- the submission. Only approval creates the customer and the draft quote.
-- The AI never creates or changes a customer, quote, or policy.

CREATE TABLE IF NOT EXISTS submissions (
  submission_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  submission_number text NOT NULL,
  -- RECEIVED, READING, READ_FAILED, READY_FOR_REVIEW, IN_REVIEW, COMPLETED, DECLINED
  status text NOT NULL DEFAULT 'RECEIVED',
  channel text NOT NULL DEFAULT 'upload',
  subject text,
  broker_name text,
  broker_email text,
  insured_name text,
  product_code text,
  notes text,
  assigned_to text,
  -- Which extractor read the documents, which model, when, and its summary.
  ai_run jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Reviewer's customer decision: { mode: 'new' | 'existing', customerId }.
  customer_choice jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_error text,
  approved_by text,
  approved_at timestamptz,
  attestation text,
  declined_by text,
  declined_at timestamptz,
  decline_reason text,
  customer_id uuid,
  quote_id uuid,
  quote_number text,
  created_by text,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, submission_number)
);

CREATE INDEX IF NOT EXISTS submissions_tenant_status_idx ON submissions (tenant_id, status, received_at DESC);

CREATE TABLE IF NOT EXISTS submission_documents (
  document_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id uuid NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  -- Text lines read from the document, used to show where a value came from.
  -- Empty when the format can only be read by an AI model (PDF, image).
  text_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  readable_without_ai boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_documents_submission_idx ON submission_documents (tenant_id, submission_id);

CREATE TABLE IF NOT EXISTS submission_fields (
  submission_id uuid NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  field_key text NOT NULL,
  section text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  -- What the extractor proposed. Never changed after extraction.
  ai_value text,
  -- high, medium, low, missing, conflict
  confidence text NOT NULL DEFAULT 'missing',
  -- [{ documentId, line, page, quote }]
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Competing values when documents disagree: [{ value, documentId, line, page, quote }]
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  -- The value the reviewer is working with; starts as ai_value.
  value text,
  -- pending, accepted
  status text NOT NULL DEFAULT 'pending',
  decided_by text,
  decided_at timestamptz,
  PRIMARY KEY (submission_id, field_key)
);

CREATE TABLE IF NOT EXISTS submission_events (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id uuid NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  -- ai, user, system
  actor_type text NOT NULL,
  actor text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_events_submission_idx ON submission_events (tenant_id, submission_id, created_at);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON submissions;
CREATE POLICY tenant_isolation ON submissions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE submission_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON submission_documents;
CREATE POLICY tenant_isolation ON submission_documents
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE submission_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON submission_fields;
CREATE POLICY tenant_isolation ON submission_fields
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE submission_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON submission_events;
CREATE POLICY tenant_isolation ON submission_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Permissions. The catalog in server/src/lib/rbac.ts seeds these for new
-- tenants; existing tenants' system underwriter and agent roles get them
-- here, since role seeding never adds to a role that already has grants.
-- Only roles that already hold grants are touched: a role with none is still
-- waiting for its defaults, and a grant here would stop that seeding.
INSERT INTO rbac_permissions (permission_code, scope, resource_key, action_key, label, description, sort_order) VALUES
  ('menu.submissions.view', 'menu', 'submissions', 'view', 'Menu: Submissions', 'View the submission intake menu entry', 22),
  ('page.submissions.view', 'page', 'submissions', 'view', 'Page: Submissions', 'Access the submission intake inbox and review pages', 142),
  ('submissions.read', 'api', 'submissions', 'read', 'Submission API: Read', 'Read submissions, their documents, drafted values, and activity', 760),
  ('submissions.manage', 'api', 'submissions', 'manage', 'Submission API: Manage', 'Upload submissions, run AI reading, and confirm or correct drafted values', 770),
  ('submissions.approve', 'api', 'submissions', 'approve', 'Submission API: Approve', 'Approve reviewed submissions, creating the customer and draft quote, or decline them', 780)
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO rbac_role_permissions (tenant_id, role_code, permission_code, created_at, created_by)
SELECT r.tenant_id, r.role_code, p.code, now(), 'migration:060'
  FROM rbac_roles r
  CROSS JOIN (VALUES ('menu.submissions.view'), ('page.submissions.view'), ('submissions.read'), ('submissions.manage'), ('submissions.approve')) AS p(code)
 WHERE r.role_code = 'underwriter' AND r.is_system = true
   AND EXISTS (SELECT 1 FROM rbac_role_permissions x WHERE x.tenant_id = r.tenant_id AND x.role_code = r.role_code)
ON CONFLICT (tenant_id, role_code, permission_code) DO NOTHING;

INSERT INTO rbac_role_permissions (tenant_id, role_code, permission_code, created_at, created_by)
SELECT r.tenant_id, r.role_code, p.code, now(), 'migration:060'
  FROM rbac_roles r
  CROSS JOIN (VALUES ('menu.submissions.view'), ('page.submissions.view'), ('submissions.read'), ('submissions.manage')) AS p(code)
 WHERE r.role_code = 'agent' AND r.is_system = true
   AND EXISTS (SELECT 1 FROM rbac_role_permissions x WHERE x.tenant_id = r.tenant_id AND x.role_code = r.role_code)
ON CONFLICT (tenant_id, role_code, permission_code) DO NOTHING;

-- On-demand job that reads a submission (no schedule; queued per read).
INSERT INTO job_definitions (job_code, description, enabled, default_schedule, default_max_attempts, default_timeout_seconds)
VALUES (
  'submission_extract',
  'Reads a submission''s documents with the configured intake extractor and drafts values for review.',
  false,
  NULL,
  1,
  600
)
ON CONFLICT (job_code) DO NOTHING;

COMMIT;
