BEGIN;

-- Second job type per docs/JOB_QUEUE_DESIGN.md's "Still Open" follow-up list:
-- scans a tenant's in-force book for policies approaching renewal and creates
-- a renewal-reminder notification intent per candidate. Disabled by default,
-- same as the framework's convention of requiring explicit opt-in before a
-- job type runs automatically (recurring scheduling itself still depends on
-- slice 4 of the job queue design, which is not implemented yet; this job is
-- runnable today via a manual enqueue or the admin "run now" API).
INSERT INTO job_definitions (job_code, description, enabled, default_schedule, default_max_attempts, default_timeout_seconds)
VALUES (
  'renewal_candidate_scan',
  'Scans a tenant''s in-force policies for upcoming renewals and creates a renewal-reminder notification intent per candidate.',
  false,
  'interval:24h',
  3,
  300
)
ON CONFLICT (job_code) DO NOTHING;

COMMIT;
