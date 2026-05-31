BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_ml_config jsonb NOT NULL DEFAULT '{
    "enabled": false,
    "shadowMode": true,
    "provider": "internal-baseline",
    "modelVersionByProduct": {
      "personal-auto": "pa-risk-v1",
      "homeowners": "ho-risk-v1"
    },
    "features": {
      "riskScoring": true,
      "fraudDetection": true,
      "premiumOptimization": true,
      "coverageRecommendations": true
    },
    "thresholds": {
      "riskReferral": 0.72,
      "fraudReview": 0.65,
      "premiumVariance": 0.2
    }
  }'::jsonb;

UPDATE tenants
SET ai_ml_config = '{
  "enabled": false,
  "shadowMode": true,
  "provider": "internal-baseline",
  "modelVersionByProduct": {
    "personal-auto": "pa-risk-v1",
    "homeowners": "ho-risk-v1"
  },
  "features": {
    "riskScoring": true,
    "fraudDetection": true,
    "premiumOptimization": true,
    "coverageRecommendations": true
  },
  "thresholds": {
    "riskReferral": 0.72,
    "fraudReview": 0.65,
    "premiumVariance": 0.2
  }
}'::jsonb
WHERE ai_ml_config IS NULL OR jsonb_typeof(ai_ml_config) <> 'object';

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS ai_insights jsonb;

CREATE TABLE IF NOT EXISTS ai_inference_events (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  quote_id uuid,
  policy_id uuid,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL,
  model_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_ai_inference_events_tenant_created
  ON ai_inference_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_inference_events_quote
  ON ai_inference_events(tenant_id, quote_id, created_at DESC);

ALTER TABLE ai_inference_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'ai_inference_events'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON ai_inference_events USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

COMMIT;
