BEGIN;

ALTER TABLE documents
  ADD COLUMN version_id uuid,
  ADD COLUMN input_hash text,
  ADD COLUMN form_set_hash text,
  ADD COLUMN integrity_status text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (integrity_status IN ('VERIFIED','UNVERIFIED','FAILED')),
  ADD COLUMN delivery_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE policy_forms
  ADD COLUMN edition text,
  ADD COLUMN snapshot_hash text;

CREATE INDEX idx_documents_version ON documents(tenant_id, version_id);
CREATE INDEX idx_documents_integrity ON documents(tenant_id, integrity_status);

COMMIT;
