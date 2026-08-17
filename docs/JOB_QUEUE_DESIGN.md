# Production Job Queue First Slice

This note turns the production batch scheduler backlog into a small
implementable slice. It intentionally builds on the existing PostgreSQL-backed
async outbox pattern instead of introducing a separate queue dependency for the
first version.

## Goals

- Provide a durable job registry and run history for production operations.
- Execute jobs with tenant-scoped database context.
- Support safe retries, dead-letter handling, and idempotent side effects.
- Keep the first slice small enough to implement and test before adding a full
  scheduler dashboard.

## First Job Type

The first job type should be `async_outbox_delivery_retry`.

Why this job first:

- The repo already has `async_message_outbox` and `startAsyncMessageWorker`.
- Delivery retry is operationally important and naturally idempotent by
  `async_message_outbox.message_id`.
- It avoids inventing business-domain scheduling behavior before the job
  framework itself is proven.

The job should claim due `async_message_outbox` rows with status `Pending` or
`Retry`, dispatch them through the configured delivery adapter, and update each
row to `Sent`, `Retry`, or `Failed`.

## Schema Boundaries

Add the first generic job tables in a new migration. Table names are proposed;
future implementation can adjust column names as long as the behavior remains
equivalent.

### `job_definitions`

Registry table for supported jobs.

- `job_code` primary key, for example `async_outbox_delivery_retry`.
- `description`.
- `enabled`.
- `default_schedule` nullable cron expression or simple interval key.
- `default_max_attempts`.
- `default_timeout_seconds`.
- `created_at`, `updated_at`.

This table is global because job capabilities are platform-level. Per-tenant
enablement belongs in `job_schedules`.

### `job_schedules`

Tenant-scoped schedule and operational controls.

- `schedule_id` UUID primary key.
- `tenant_id` required.
- `job_code` references `job_definitions`.
- `enabled`.
- `schedule_expression` nullable.
- `concurrency_key` defaulting to `tenant_id || ':' || job_code`.
- `request_payload` JSONB for job-specific filters.
- `next_run_at`, `last_run_at`.
- `created_at`, `updated_at`.

Use tenant RLS on this table.

### `job_runs`

Durable run history and checkpoint state.

- `run_id` UUID primary key.
- `tenant_id` required.
- `job_code` required.
- `schedule_id` nullable.
- `idempotency_key` required.
- `status`: `Queued`, `Running`, `Succeeded`, `Retry`, `DeadLettered`,
  `Cancelled`.
- `attempts`, `max_attempts`.
- `checkpoint` JSONB, for example last claimed message ID or count summary.
- `request_payload` JSONB.
- `result_payload` JSONB.
- `last_error`.
- `locked_by`, `locked_until`.
- `next_attempt_at`.
- `started_at`, `finished_at`, `created_at`, `updated_at`.

Recommended constraints and indexes:

- Unique `(tenant_id, idempotency_key)`.
- Dispatch index on `(status, next_attempt_at, created_at)`.
- Tenant history index on `(tenant_id, job_code, created_at desc)`.
- RLS policy requiring `tenant_id = current_setting('app.tenant_id')`.

### `job_run_events`

Append-only operational log for audit/debug.

- `event_id` UUID primary key.
- `tenant_id` required.
- `run_id` references `job_runs`.
- `event_type`, for example `claimed`, `checkpointed`, `retry_scheduled`,
  `dead_lettered`, `completed`.
- `message`.
- `payload` JSONB.
- `created_at`.

Use tenant RLS on this table.

## Service Boundaries

Keep the first implementation behind server-side services before adding admin
UI.

- `server/src/jobs/registry.ts`: typed registry mapping `job_code` to a handler,
  default retry policy, and payload schema.
- `server/src/jobs/jobQueue.ts`: enqueue, claim, heartbeat/checkpoint, complete,
  retry, and dead-letter helpers.
- `server/src/jobs/worker.ts`: stateless polling worker with configurable poll
  interval, batch size, lock timeout, and worker ID.
- `server/src/jobs/handlers/asyncOutboxDeliveryRetry.ts`: first handler that
  reuses the current async message dispatch behavior.
- `server/src/routes/admin-jobs.routes.ts`: later first API surface for listing
  definitions/runs and manually enqueueing or retrying a run.

The existing `server/src/asyncMessageWorker.ts` can either be adapted into the
first handler or wrapped by it. The important boundary is that the generic job
worker owns job run history, locking, retry, and dead-letter status while the
handler owns domain-specific work.

## Queue And Claim Strategy

Use PostgreSQL row locking for the first slice:

1. Enqueue a `job_runs` row with `status = 'Queued'`, `next_attempt_at <= now()`,
   and an idempotency key.
2. Worker claims rows in a transaction with `FOR UPDATE SKIP LOCKED`.
3. Claim changes the run to `Running`, increments attempts, sets `locked_by`,
   and sets `locked_until`.
4. Worker refreshes `locked_until` for long-running jobs.
5. Completion writes final status and result payload in the same tenant context.
6. A later sweeper can move expired `Running` rows back to `Retry` when
   `locked_until < now()`.

This matches the existing outbox worker's durable claim pattern and works with
multiple stateless worker processes.

## Idempotency And Checkpointing

Every enqueue path must provide a stable idempotency key. Suggested keys:

- Scheduled run: `schedule:<schedule_id>:<scheduled_fire_time>`.
- Manual run: `manual:<tenant_id>:<job_code>:<request_hash>`.
- Outbox retry batch: `outbox-retry:<tenant_id>:<time_bucket>`.

Handlers must checkpoint before external side effects when possible, or
immediately after a successful side effect when the external target determines
success. For outbox delivery, `async_message_outbox.message_id` remains the
side-effect idempotency key, and the job checkpoint stores counts plus the
claimed message IDs for traceability.

## Retry, Backoff, And Dead Letter

Retry policy should be job-specific but share defaults:

- Retry only transient failures.
- Exponential backoff with configurable base and cap.
- Keep `last_error` truncated to a safe length.
- Mark terminal failures as `DeadLettered` in `job_runs`.
- Keep domain-specific terminal rows in their own table status too, for example
  `async_message_outbox.status = 'Failed'`.

Operators should be able to manually enqueue a retry from a dead-lettered run in
a later admin API slice. The retry must create a new `job_runs` row that
references the prior run in `request_payload` or `result_payload`; do not mutate
history to make an old run look successful.

## Tenant Safety

All job schedules, runs, and run events must include `tenant_id` and use tenant
RLS. Worker execution must set tenant context before reading or writing
tenant-scoped tables.

Rules to preserve:

- A claimed run can only process records for its own tenant.
- Logs and result payloads must not contain secrets or cross-tenant data.
- Global job definitions can describe capabilities, but operational run state
  is tenant-scoped.
- Customer portal data and customer-safe projections remain outside this first
  job slice unless a future portal-specific job is designed.

## Runtime Controls

Add controls alongside the existing async worker variables:

- `JOB_WORKER_ENABLED`.
- `JOB_WORKER_POLL_MS`.
- `JOB_WORKER_BATCH_SIZE`.
- `JOB_WORKER_LOCK_SECONDS`.
- `JOB_WORKER_ID`, defaulting to hostname plus process ID.

`ASYNC_PUSH_*` should remain the delivery-adapter controls for outbox messages.
The job worker controls orchestration and run history.

## API Boundary

The first API slice can be admin-only and read-heavy:

- `GET /v1/admin/jobs/definitions`.
- `GET /v1/admin/jobs/runs?jobCode=&status=&tenantId=`.
- `GET /v1/admin/jobs/runs/:runId`.
- `POST /v1/admin/jobs/runs` to enqueue an allowed manual run.
- `POST /v1/admin/jobs/runs/:runId/retry` for dead-letter follow-up.

Guard with an operations/admin permission such as `admin.jobs.read` and
`admin.jobs.manage`. Until those permissions exist, keep the worker service
internal and avoid exposing a partial unsecured API.

## Test Plan

Unit tests:

- Registry rejects unknown job codes and validates payloads.
- Backoff calculator caps delays correctly.
- Queue helper produces stable idempotency keys.
- Handler maps success, retryable failure, and terminal failure correctly.

DB-backed integration tests:

- Migration creates job tables with tenant RLS.
- Two workers cannot claim the same queued run.
- Duplicate enqueue with the same tenant/idempotency key returns the existing
  run instead of creating another.
- A run for tenant A cannot process tenant B outbox rows.
- Exhausted retries move the run to `DeadLettered`.

Operational smoke tests:

- Start Docker Compose with `JOB_WORKER_ENABLED=true`.
- Insert due outbox rows for `sample-carrier`.
- Confirm the worker marks rows sent locally or schedules retries when the
  webhook returns a transient failure.

## Follow-Up Slices

1. Implement the migration, registry, queue helper, and outbox delivery retry
   handler.
2. Add admin read APIs for definitions and run history.
3. Add manual retry API for dead-lettered runs.
4. Add scheduler creation/next-run calculation.
5. Add UI dashboard after the API and permissions are stable.
