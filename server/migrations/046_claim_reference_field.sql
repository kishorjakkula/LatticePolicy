-- Claim reference field for claims-handoff bordereau reporting (issue #225).
--
-- Adds a minimal, nullable external claim reference to policy_versions so a
-- transaction can be associated with a claim in an external claims system.
-- This is a reference/handoff field only -- no claims processing,
-- adjudication, or financial data is modeled here, matching the framework
-- boundary documented in docs/ARCHITECTURE.md.

BEGIN;

ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS claim_reference text;

COMMIT;
