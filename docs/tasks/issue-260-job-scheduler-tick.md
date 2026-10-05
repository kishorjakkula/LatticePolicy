# Task Note: Job Scheduler Tick

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/260
- Pull request: pending

## Summary

The job worker now turns due `job_schedules` rows into queued `job_runs` and
executes them through the existing worker path. Schedule locking, idempotent
run creation, and cadence advancement happen in one PostgreSQL transaction.

## Important Files

- `server/src/jobs/scheduler.ts`: due-schedule claim, interval calculation,
  run creation, and schedule advancement.
- `server/src/jobs/worker.ts`: runs the scheduler before claiming executable
  jobs on every worker iteration.
- `server/src/jobs/__tests__/scheduler.test.ts`: interval parser and missed-run
  behavior tests.
- `server/src/__tests__/job-queue.integration.test.ts`: real PostgreSQL test
  proving a due schedule creates and completes a run.
- `docs/JOB_QUEUE_DESIGN.md`: records supported expressions and runtime rules.

## Behavior Rules

- Scheduled-run idempotency keys are
  `schedule:<schedule_id>:<scheduled_fire_time>`.
- Concurrent workers use `FOR UPDATE SKIP LOCKED`; one schedule occurrence can
  produce at most one run.
- Supported expressions are `interval:<positive integer><s|m|h|d>`.
- Missed intervals are coalesced; `next_run_at` becomes the first occurrence
  after the scheduler tick time.
- Invalid expressions disable their schedule and emit a warning so they do not
  starve valid schedules.
- Tenant ID and request payload are copied from the schedule to its run.

## Automated Tests

- Unit tests cover all interval units, missed intervals, and invalid input.
- The DB integration test creates a due tenant schedule, invokes the normal
  worker iteration, and verifies run success plus `last_run_at` and
  `next_run_at` advancement.

## Validation

```bash
npm run test --workspace=server
npm run test:integration
npm run typecheck
npm run build
```

The local unit, typecheck, and build commands pass. The integration command
requires Docker and could not run locally because the Docker daemon was not
running; GitHub CI executes the same PostgreSQL-backed suite.

## Follow-Ups Or Risks

- Cron syntax is intentionally unsupported. Add it only with an explicit
  parser and deterministic timezone semantics.
- Schedule-management UI remains part of the later dashboard slice.
