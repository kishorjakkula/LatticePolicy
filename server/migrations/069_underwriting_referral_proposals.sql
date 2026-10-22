ALTER TABLE underwriting_referrals
  ADD COLUMN proposal_hash text,
  ADD COLUMN proposal_snapshot jsonb,
  ADD CONSTRAINT underwriting_referral_proposal_pair CHECK (
    (proposal_hash IS NULL AND proposal_snapshot IS NULL) OR
    (proposal_hash IS NOT NULL AND proposal_hash ~ '^[0-9a-f]{64}$'
      AND proposal_snapshot IS NOT NULL AND jsonb_typeof(proposal_snapshot) = 'object'
      AND proposal_snapshot ? 'schemaVersion' AND proposal_snapshot ? 'tenantId'
      AND proposal_snapshot->>'schemaVersion' = '1'
      AND proposal_snapshot->>'tenantId' = tenant_id)
  );

CREATE FUNCTION protect_referral_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash
    OR NEW.proposal_snapshot IS DISTINCT FROM OLD.proposal_snapshot THEN
    RAISE EXCEPTION 'Referral proposal evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER underwriting_referral_proposal_immutable
  BEFORE UPDATE ON underwriting_referrals
  FOR EACH ROW EXECUTE FUNCTION protect_referral_proposal();
