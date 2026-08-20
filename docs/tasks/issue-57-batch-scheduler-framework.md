# Task Note: Batch And Scheduler Framework First Slice

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/57
- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/165

## Summary

Implemented the first slice of the durable batch/scheduler framework
described in `docs/JOB_QUEUE_DESIGN.md` (written for issue #38). Adds a
tenant-scoped job registry, run history, retry/dead-letter handling, a
stateless polling worker, and an admin API, with `async_outbox_delivery_retry`
as the first real job type.

## Important Files

- `server/migrations/042_job_queue_framework.sql`: `job_definitions`,
  `job_schedules`, `job_runs`, `job_run_events` with tenant RLS on the three
  tenant-scoped tables.
- `server/src/jobs/registry.ts`: typed job registry with Zod payload
  validation.
- `server/src/jobs/jobQueue.ts`: enqueue (idempotent), claim
  (`FOR UPDATE SKIP LOCKED`, cross-tenant), checkpoint, complete,
  retry/dead-letter, manual dead-letter retry.
- `server/src/jobs/worker.ts`: stateless polling worker
  (`JOB_WORKER_ENABLED`, default off).
- `server/src/jobs/handlers/asyncOutboxDeliveryRetry.ts`: first handler,
  reuses the existing outbox worker's claim/dispatch functions, scoped to the
  job run tenant.
- `server/src/asyncMessageWorker.ts`: exported `claimOutboxRows`,
  `dispatchOutboxRow` (now returns a success boolean), and `loadConfig` so
  the job handler can reuse them without duplicating logic.
- `server/src/routes/admin-jobs.routes.ts`: admin read/enqueue/retry API.
- `server/src/lib/rbac.ts`: `admin.jobs.read`/`admin.jobs.manage`
  permissions, `jobs_admin` role.
- `server/src/index.ts`: registers built-in jobs and starts the job worker
  alongside the existing async message worker.
- `docs/JOB_QUEUE_DESIGN.md`: added an "Implementation Status" section
  documenting what's built vs. still open, and a short guide for adding a
  new job type.

## Behavior Rules

- `claimDueRuns` claims across all tenants in one raw query (same pattern as
  the existing outbox worker) because the worker cannot know which tenant has
  due work before claiming a row. Every subsequent read/write for a claimed
  run goes through `withTenantTx` using that run's own `tenant_id`, so
  tenant RLS is honored for all tenant-scoped state changes.
- `enqueueJob` is idempotent on `(tenant_id, idempotency_key)`: a repeat
  enqueue with the same key returns the existing run rather than creating a
  duplicate.
- A retry never mutates an existing run's history; `retryDeadLetteredRun`
  always creates a new run referencing the source run.
- `JOB_WORKER_ENABLED` defaults to `false` — unlike the always-on async push
  worker, this first slice must be explicitly enabled.
- Only `async_outbox_delivery_retry` is registered as a job type in this
  slice; scheduler creation/next-run calculation and a UI dashboard are
  explicitly out of scope (see design doc's "Still Open" section).
- `async_outbox_delivery_retry` must only claim outbox rows for the tenant on
  the claimed `job_runs` row. The standalone async push worker can still claim
  globally, but tenant-scoped job runs must not dispatch another tenant's
  messages.

## Automated Tests

- Tests added or updated:
  - `server/src/jobs/__tests__/registry.test.ts` (unit): registration,
    unknown job code rejection, payload schema validation.
  - `server/src/jobs/__tests__/jobQueue.test.ts` (unit): backoff calculator.
  - `server/src/__tests__/job-queue.integration.test.ts` (DB integration):
    RLS policies exist, duplicate enqueue idempotency, tenant isolation,
    two concurrent claims cannot claim the same run, checkpoint/complete,
    retry-then-dead-letter after exhausting attempts, and an end-to-end run
    of the `async_outbox_delivery_retry` handler against a real outbox row,
    including a regression that a tenant A job leaves tenant B outbox rows
    untouched.
- Test layer used: unit tests for pure logic (registry, backoff), DB
  integration tests for concurrency/locking/RLS/retry behavior that can't be
  proven without a real Postgres instance.
- Why this layer is enough: the design doc's own test plan calls for exactly
  this split; DB integration tests were run against a disposable
  `postgres:15` Docker container via `npm run test:integration`.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration
```

All four passed, including `job-queue.integration.test.ts` (9/9) and the
full integration suite (38/38 across 11 files) with no regressions to
existing outbox/tenant-isolation behavior.

## Follow-Ups Or Risks

- Scheduler creation/next-run calculation (turning a `job_schedules` row into
  automatic recurring runs) is not implemented — rows can be inserted but
  nothing acts on `next_run_at` yet. This is explicitly slice 4 in the
  design doc.
- No admin UI dashboard yet (slice 5) — the API exists and is RBAC-gated,
  ready for a UI to consume. Issue #58 (operational admin dashboards) is a
  natural place for a job-status panel once this merges.
- Only one job type is registered. Stale-quote-cleanup and
  renewal-candidate-scan (mentioned in the issue as example jobs) are good
  follow-up jobs using the "Adding A New Job Type" pattern now documented in
  `docs/JOB_QUEUE_DESIGN.md`.
- `dispatchOutboxRow`'s signature changed from `Promise<void>` to
  `Promise<boolean>` to let the new handler report accurate
  sent/retried-or-failed counts. Behavior for its only prior caller
  (`asyncMessageWorker.ts`'s own poll loop) is unchanged — it already just
  awaited the call without using a return value.
