# Intake Recovery Hardening

## Summary

Local correctness fixes in the shared private-document-engine worktree. No
issue closure, GitHub changes, or commit. Existing private-provider work is
preserved; `document-text.ts` is owned separately and was not edited here.

## Important Files

- `server/src/services/submission-intake.service.ts`: durable scheduling failure
  and explicit manual review recovery.
- `server/src/services/quote.service.ts`: the shared draft insert helper must
  throw on its fifth collision, not return an id for a nonexistent quote.
- `server/src/routes/submissions.routes.ts`: tenant-scoped manual-review action
  guarded by `submissions.manage`.
- `server/src/__tests__/submission-intake.integration.test.ts`: PostgreSQL
  regressions, including real router permission/tenant checks.
- `frontend/src/api/submissions.api.ts` and
  `frontend/src/features/submissions/SubmissionReviewPage.tsx`: manual recovery,
  failed/stale-read retries, product hint preservation, confirmation warning.
- `frontend/src/api/__tests__/client.test.ts` and
  `frontend/src/features/submissions/__tests__/SubmissionReviewPage.test.tsx`:
  API transport and recovery controls.
- `docs/SUBMISSION_INTAKE.md`: recovery lifecycle and API behavior.

## Behavior Rules

- Exhausting quote insert retries throws the original unique violation. The
  approval transaction rolls back its new customer and emits no approval or
  quote-created event. Each collision rolls back and releases its savepoint;
  successful later attempts leave the caller's transaction usable.
- Enqueue exceptions are compensated in a separate tenant transaction with
  `READ_FAILED`, a safe retry message, finish time, and `reading_schedule_failed`
  event. The upload retains its id in its response instead of becoming an
  apparent failed upload. Raw scheduler errors are not exposed to reviewers.
- Compensation locks and checks both status and run token. It cannot overwrite
  a newer read or completed result; ambiguously enqueued old jobs cannot write
  after failure or manual recovery.
- Manual recovery accepts only `READ_FAILED`. It retains prior proposals and
  decisions, or creates blank missing/pending fields from the carrier schema.
  It creates no business records and invokes no extractor. Confirmation,
  required-field checks, customer validation, and attestation remain mandatory.
- The UI offers manual entry and immediate retry after failure, and restart for
  existing stale reads or received submissions. Retry warns about confirmations
  and retains the chosen/known product hint.

## Validation

Node 22.23.3 was located at
`/Users/srividyajakkula/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`.
Commands ran with that directory prepended to `PATH`, from the worktree root.

- `npm run test:integration --workspace=server -- src/__tests__/submission-intake.integration.test.ts`:
  16 passed against a fresh disposable PostgreSQL 15 database.
- `npm run test --workspace=frontend -- src/features/submissions/__tests__/SubmissionReviewPage.test.tsx src/api/__tests__/client.test.ts`:
  20 passed.
- `npm run typecheck`: passed (root workspace scripts).
- `npm run build:server`: passed (also checks server TypeScript).
- `npm run test:server -- src/__tests__/quote-policy-fallback.test.ts src/lib/intake/__tests__/intake.test.ts src/lib/intake/__tests__/private-extractor.test.ts`:
  47 passed.
- `git diff --check`: passed.

## Follow-Ups Or Risks

- Scheduling compensation cannot be atomic with an external scheduler. If the
  process dies between marking `READING` and recording failure, or the database
  is unavailable during compensation, the existing 15-minute stale-read retry
  remains the recovery path. No outbox or automatic requeue is introduced.
- Integration fixtures require a fresh database; rerunning against the same
  database produces expected duplicate-customer/quote fixture collisions.
- PostgreSQL integration output includes an existing concurrent-query
  deprecation warning. No full browser or repository-wide suite was run.
