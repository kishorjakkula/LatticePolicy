# Task Note: Renewal Candidate Scan Job

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/224
- Pull request:

## Summary

Added the second job type to the batch/scheduler framework (issue #57):
`renewal_candidate_scan`. It scans a tenant's in-force book for policies
whose term expires within a configurable window and creates a
renewal-reminder notification intent per candidate. It does not bind or
execute a renewal — an underwriter/agent still drives the actual renewal
transaction.

## Important Files

- `server/migrations/047_renewal_candidate_scan_job.sql`: seeds the
  `job_definitions` row, disabled by default (matches the framework's
  opt-in convention).
- `server/src/jobs/handlers/renewalCandidateScan.ts`: the handler, plus
  `computeRenewalWindowBounds`, a pure date-window function kept separate
  from the SQL so it's unit-testable without a database.
- `server/src/jobs/registerBuiltinJobs.ts`: registers the new job code with
  a Zod payload schema (`windowDays`, optional, positive integer).
- `server/src/services/notification.service.ts`: added
  `POLICY_RENEWAL_REMINDER` to `NotificationEventType` and its default
  template, following the exact pattern of the three existing event types.

## Behavior Rules

- Candidate exclusion is enforced in SQL, not just the date window:
  `status = 'Issued'` (excludes cancelled), `non_renewed_at IS NULL`
  (excludes explicit non-renewals), and `NOT EXISTS (... type = 'Renew'
  ...)` (excludes already-renewed policies).
- **Important discovered behavior, not a bug I introduced**: I traced
  `renewPolicy()` in `server/src/services/lifecycle.service.ts` and found
  it never issues an `UPDATE policies SET term_expiration_date = ...`
  statement — the policy's stored `term_expiration_date` is not advanced
  when it's renewed (renewal state instead lives in the timeline via a new
  `policy_versions`/`policy_transactions` row). Because of this, a scan
  that trusted `term_expiration_date` alone would keep flagging an
  already-renewed policy as a candidate forever. The `NOT EXISTS (type =
  'Renew')` exclusion is a deliberate guard against this, not an arbitrary
  choice — do not remove it without first fixing the underlying
  `term_expiration_date` staleness, which is out of scope for this issue.
- The job identifies candidates and notifies; it never creates a
  `policy_transactions` row itself and never mutates policy state.
- `windowDays` defaults to 45 (`DEFAULT_RENEWAL_WINDOW_DAYS`), matching a
  typical pre-renewal notice period; callers can override per enqueue.
- No new admin UI was added. `server/src/routes/admin-jobs.routes.ts`'s
  existing run-history API (`GET /runs?jobCode=renewal_candidate_scan`)
  already exposes the candidate count and notified/suppressed breakdown in
  each run's `result_payload`, which is sufficient admin visibility for
  this slice per the issue's own scope note ("or note it as a follow-up if
  a full UI is out of scope"). A dedicated renewal-candidate review screen
  is a separate, larger follow-up (see issue #227 for the general job
  queue admin UI, which this can slot into once built).

## Automated Tests

- Tests added or updated:
  - `server/src/jobs/handlers/__tests__/renewalCandidateScan.test.ts` —
    unit tests for `computeRenewalWindowBounds` (basic window, year
    boundary, zero-day window, default constant).
  - `server/src/__tests__/renewal-candidate-scan.integration.test.ts` —
    DB-backed: job registration; correct candidate identification
    excluding out-of-window, cancelled, non-renewed, and already-renewed
    policies in one run; a real `notification_intents` row created with
    `event_type = 'POLICY_RENEWAL_REMINDER'`; and strict tenant isolation
    (a tenant A scan never touches tenant B's policies).
- Test layer used: unit test for the pure date-window helper, DB
  integration test for the full scan-and-notify flow.
- Why this layer is enough: the exclusion logic is a SQL query with no
  meaningful branching to unit test in isolation beyond the window
  boundaries; the integration test exercises the real exclusion
  conditions against real rows, which is what actually proves correctness
  here.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

All green: 101 frontend + 248 server unit tests (4 new), clean build,
clean typecheck.

`npm run test:integration` / `sh scripts/test-integration.sh` could not be
run in this environment: Docker's local daemon storage is corrupted at a
level below image pulls (`docker images` itself fails with a
`containerd` blob-store I/O error), a pre-existing environment issue
already noted in this repo's history (see PR #197's task note), not
something introduced by or fixable from this change. The integration
test file above was written and reviewed carefully against this
repo's exact existing patterns (`server/src/__tests__/job-queue.integration.test.ts`
for job claim/handler invocation, `server/src/__tests__/exposure.integration.test.ts`
for policy/policy_versions fixture seeding) but has not been executed
end-to-end. Recommend running it in CI or a clean Docker environment
before merge.

## Follow-Ups Or Risks

- `renewPolicy()` not updating `policies.term_expiration_date` (see
  Behavior Rules above) is a pre-existing gap outside this issue's scope,
  but worth a maintainer's attention — it could affect other code that
  reads `term_expiration_date` expecting it to reflect the current term
  after a renewal.
- The `NOT EXISTS (type = 'Renew')` exclusion assumes a policy is renewed
  at most in a way that always leaves a `Renew` transaction row; if a
  future renewal path is added that doesn't insert one, this exclusion
  would silently stop working. No code today does that, but flagging for
  awareness.
- `interval:24h` is set as the `default_schedule` in the migration, but
  actual recurring firing depends on job queue design slice 4
  (scheduler creation/next-run calculation), which is not implemented —
  same limitation the first job type (`async_outbox_delivery_retry`) has.
  This job is runnable today via manual enqueue or the admin "run now"
  API, not yet on an automatic timer.
- The integration test could not be executed due to the Docker
  environment issue described above; please verify it passes in CI.
