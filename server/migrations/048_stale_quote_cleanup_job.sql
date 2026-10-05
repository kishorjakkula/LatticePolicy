BEGIN;

INSERT INTO job_definitions (job_code, description, enabled, default_schedule, default_max_attempts, default_timeout_seconds)
VALUES (
  'stale_quote_cleanup',
  'Expires inactive draft and rated quotes after a configurable age.',
  false,
  'interval:24h',
  3,
  300
)
ON CONFLICT (job_code) DO NOTHING;

COMMIT;
