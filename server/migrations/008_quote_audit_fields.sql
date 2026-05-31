BEGIN;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS step_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE quotes
   SET step_history = '[]'::jsonb
 WHERE step_history IS NULL OR jsonb_typeof(step_history) <> 'array';

UPDATE quotes
   SET status_history = '[]'::jsonb
 WHERE status_history IS NULL OR jsonb_typeof(status_history) <> 'array';

UPDATE quotes
   SET step_history = step_history || jsonb_build_array(
     jsonb_build_object(
       'value', COALESCE(progress_step, 1),
       'updatedAt', COALESCE(updated_at, created_at, now()),
       'updatedBy', COALESCE(updated_by, 'system')
     )
   )
 WHERE jsonb_array_length(step_history) = 0;

UPDATE quotes
   SET status_history = status_history || jsonb_build_array(
     jsonb_build_object(
       'value', COALESCE(status, 'Draft'),
       'updatedAt', COALESCE(updated_at, created_at, now()),
       'updatedBy', COALESCE(updated_by, 'system')
     )
   )
 WHERE jsonb_array_length(status_history) = 0;

COMMIT;
