# Task Note: Production Job Queue First Slice Design

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/38
- Pull request:

## Summary

Documented the first production job queue slice for LatticePolicy. The design
uses PostgreSQL-backed job definitions, tenant schedules, durable job runs, and
run events, and it chooses async outbox delivery retry as the first job type so
the implementation can build on the current outbox worker.

## Important Files

- `docs/JOB_QUEUE_DESIGN.md`: first-slice schema, service, retry,
  checkpointing, tenant-safety, API, and test plan.
- `docs/ARCHITECTURE.md`: links the high-level batch processing section to the
  detailed first-slice design.

## Behavior Rules

- Generic job run state is tenant-scoped and must use tenant RLS.
- Workers claim jobs with PostgreSQL `FOR UPDATE SKIP LOCKED` and stable
  idempotency keys.
- Handlers own domain-specific work; the generic worker owns run history,
  locking, retry, checkpoint, and dead-letter semantics.
- The first job type is `async_outbox_delivery_retry`, reusing the existing
  async outbox delivery model.

## Automated Tests

- Tests added or updated: none.
- Test layer used: documentation review only.
- Why this layer is enough: issue #38 is a research/design task whose
  acceptance criteria require design notes and a documented test plan before
  implementation.

## Validation

```bash
git diff --check
```

## Follow-Ups Or Risks

- Implement the migration, registry, queue helper, worker, and first outbox
  retry handler in a follow-up issue.
- Add admin job permissions before exposing job run APIs.
- Keep the existing `ASYNC_PUSH_*` delivery controls separate from the new
  `JOB_WORKER_*` orchestration controls.
