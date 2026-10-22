# Unit and integration tests — WP-0004

Status: tested snapshot recorded below; stage not complete. Gate B reopened
for the outstanding proposal-binding security design extension.

## Tests added

New/updated component suites cover navigation by role, tenant/user count-cache
isolation and logout, dialog reasons/focus/busy/retry behavior, referral queue
and detail decisions, wizard ordering/saved drafts/phone stepper, submission
attention and bulk confirmation, compliance selection/batch errors, security
matrix edits, AI audit paging/filter/detail, and dashboard boundaries.

Standards tests cover color tokens, native dialogs and shared radio controls.
OpenAPI tests lock in the bounded bulk and audit contracts. HTTP integration
adds endorsement/renewal/rewrite rejection, concurrent first attempts, retained
referrals, separate approval and successful retry.

## Results

- Node 22.23.3: `npm test --workspace=frontend -- --maxWorkers=2`:
  87 files, 572 passed on the latest completed run.
- `npm test --workspace=server -- --maxWorkers=1`: final run 92 files,
  863 passed, including reason/date/consumption gate regressions.
- OpenAPI plus referral-gate focused rerun: 31 passed after the boundary fix.
- Final PostgreSQL full suite: 41 files, 296 passed, tenant RLS enabled on a
  fresh dedicated `lattice_policy_integration` database. Includes concurrent
  first attempts, retained work items and ordinary-to-authority escalation
  followed by separate approval through real HTTP for all three transactions.
- `npm run typecheck` and explicit server `tsc --noEmit`: passed.
- Concurrent unbounded suites timed out under machine contention. Assertions
  and global timeouts were not relaxed; bounded-worker reruns replaced them.
- A subsequent DB rerun used an unsupported database name and was correctly
  refused by two disposable-data guards (232 passed, 64 skipped). A new exact
  `lattice_policy_integration` database was used for the final passing run;
  guards remain intact.

## Approved Proposal-Binding Extension: Latest Results (2026-10-21)

- Full frontend: 87 files, **586 passed** (including malicious redaction-marker regression).
- Full server: 93 files, **942 passed**.
- Full PostgreSQL integration: 41 files, **298 passed** with tenant RLS;
  Migration 069 applied on a newly created disposable database.
- Root typecheck and explicit server build passed with Node 22.23.3.
- Focused canonicalization and referral gate tests: **113 passed**. Covers
  unchanged approval reuse, same-reason changed limits, risk, premium, coverage,
  date/base version changes, consumed and legacy evidence across all four flows.
- Real HTTP tests cover concurrent matching submissions, retained immutable
  evidence, changed limits in all four flows, changed base policy version,
  legacy and forged-input refusal, approval and unchanged successful retry.
- The first Docker build caught ES-target/type errors in new test fixtures;
  fixed without changing runtime compiler settings. Rebuilt successfully.

Browser and independent review outcomes are recorded separately. These counts
supersede earlier snapshot counts above; they do not approve Gate C.

## Post-Main Integration And Local Deployment Request

Final 2026-10-21 reruns after incorporating `origin/main` (`e218c94`) and
renumbering the referral migration to 069:

- Frontend: **88 files / 594 passed** with bounded workers, including compatible
  company preservation and the main form-metadata naming regression.
- Server: **93 files / 942 passed** with bounded workers.
- Fresh PostgreSQL: **42 files / 299 passed**, tenant RLS enabled. Includes the
  new legacy 067/068 migration-number upgrade test and immutable legacy evidence.
- Root typecheck, server build, module boundaries, agent sync and delivery
  checks passed. The Docker image builds also compile both application workspaces.
- Processor 19 passed / 1 opt-in native OCR skipped; signer 3, learning 20,
  shared rules 221 passed. No GPU/model accuracy result is inferred.
- The intervening parallel DB/browser run was invalidated by Docker's confirmed
  host disk-full shutdown. Recovery preserved application volumes; the final
  database run above used another freshly provisioned container and passed.

See `docs/tasks/wp-0004-local-deployment-pr.md` for the local preview and
infrastructure record; browser results are in `09-automation-tests.md`.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| REQ-1/17 | `uw-referral-gate`, `uw-referral-routes`, `uw-referral-reason-sort`, `uw-referral.integration`, `policy-referral-http.integration`, `UwQueue`, `UwReferralDetail` |
| REQ-2 | `Dialog`, users/customers/forms dialog suites, compliance and placements component suites |
| REQ-5 | `AppNav`, `useWorkCounts`, `AdminShell`, `AdminHomePage` |
| REQ-8/9 | `QuoteWizardStepOrder`, `SubmissionReviewPage` |
| REQ-10 | `CompliancePage`, `SecurityPage`, `compliance-bulk.integration` |
| REQ-11 | `DashboardPage`, `dashboardModel`, timezone-boundary cases |
| REQ-14/15/16 | shared pager/dialog tests, `color-tokens`, browser suites in the automation handoff |
| REQ-19 | `AiAuditPage`, `AiAuditPage.phase3`, `ai-audit.api`, `ai-audit-phase3` unit/integration |
