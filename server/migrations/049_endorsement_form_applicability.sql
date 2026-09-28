ALTER TABLE forms_admin_applicability
  ADD COLUMN IF NOT EXISTS endorsement_change_criteria jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN forms_admin_applicability.endorsement_change_criteria IS
  'Explicit endorsement matching rules. Empty criteria do not attach a form to endorsements.';
