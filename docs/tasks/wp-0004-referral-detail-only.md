# WP-0004: Detail-only referral decisions

## Scope and Decision

- Implements the independent REQ-1 review finding against WP-0004's approved
  requirements/design (Gates A and B already recorded in the work package).
- `resolveReferralGateForActor` retains its public signature but never decides a
  referral. Actor roles, decision/authority permissions and `overrideReason`
  cannot approve at bind, endorsement, renewal or rewrite time.
- Existing referral creation/reuse and Approved retry behavior are unchanged.
  The explicit decision service still enforces authority, required reasons,
  tenant isolation and decision-history recording.
- Existing dirty queue/premium/reason work is preserved. No caller service,
  compliance, AI audit, root package, migration or live database changes.

## Wizard

- Later requester direction extended ownership to QuoteWizard and its tests.
  Removed inline override input/payloads and the non-persisting Submit for UW
  alert. Referral-required errors show a permission-aware detail link; ordinary
  bind/transaction retries remain available after explicit approval.
- Review opens in another tab so the wizard keeps its working state. Users
  without referral-page access see a contact-underwriter message.
- REQ-14: at 767px and below, Stepper shows `Step x of y: title` as a labelled
  toggle controlling a collapsed vertical list. Selection/step changes collapse
  it; desktop keeps the original list. Styles live only in
  `frontend/src/features/wizard/wizard-stepper.css`, using existing color tokens.

## Changed Files

- `server/src/services/uw-referral.service.ts`: remove inline decision channel.
- `server/src/__tests__/uw-referral-gate.test.ts`: all four gate contexts,
  Open/InfoRequested non-mutation, actor/authority combinations, new Open rows,
  and existing Approved retries.
- `server/src/__tests__/uw-referral.integration.test.ts`: replace inline-approval
  expectations with explicit decisions; database-backed coverage of all callers,
  authority rejection, unchanged rows and transaction/version linkage.
- `frontend/src/features/wizard/QuoteWizard.tsx` and its existing
  `__tests__/QuoteWizardStepOrder.test.tsx`: detail-review/retry and phone stepper.
- `e2e/pre-bind-checks.spec.ts`, `e2e/underwriting-authority.spec.ts`: negative
  inline overrides, unchanged referral detail, explicit approval, successful bind.
  Correct the pre-bind approval body from `notes` to `reason`.

## API Handoff

- All four transaction gates return HTTP 400 with top-level
  `{ code: 'UW_REFERRAL_REQUIRED', message, traceId }`. The referral UUID is in
  `message` as `Referral <uuid>`; there is no structured `referralId` field.
- The frontend request client wraps that JSON envelope in `Error.message`.
  `referralReviewPath` parses the envelope, recognizes only this error code and
  links to `/uw/queue/<uuid>` (queue fallback if the UUID is absent).
- Explicit decision: `PATCH /api/v1/uw/referrals/:id/decide`, body
  `{ decision: 'Approved', reason: '<review rationale>' }`. The existing
  `/approve` and `/decline` aliases still apply the same service checks.
- Blank ordinary approve/decline reason: 400 `REASON_REQUIRED`. Authority
  approval without override permission or a reason: 403
  `AUTHORITY_OVERRIDE_REQUIRED`. No transaction override bypasses these rules.

## Verification and Follow-Up

- Focused wizard tests: 15 passed with `--maxWorkers=1`, including admin,
  underwriter and agent blocked/retry flows and phone/desktop Stepper tests.
- Frontend typecheck and explicit server `tsc --noEmit`: passed.
- Focused server tests: 77 passed across `uw-referral-gate.test.ts`,
  `uw-referral-reason-sort.test.ts` and `uw-referral-routes.test.ts`, with
  `--maxWorkers=1`.
- Fresh disposable PostgreSQL integration: 27 passed across
  `uw-referral.integration.test.ts`, `coverage-integrity.integration.test.ts`,
  `quote-bind-aggregation.integration.test.ts` and
  `quote-bind-internal-consistency.integration.test.ts`, with `--maxWorkers=1`.
  A reused-database attempt hit duplicate aggregation fixture keys; the final
  passing run used a newly created empty database, `wp4_referral_fresh`, in the
  dedicated `wp4-referral-detail-only-test` container. Container removed after
  verification. No demo/pilot database was accessed.
- Commands (Node 24.21.0 available locally):
  - `npm run test --workspace=frontend -- src/features/wizard/__tests__/QuoteWizardStepOrder.test.tsx --maxWorkers=1`
  - `npm run test --workspace=server -- src/__tests__/uw-referral-gate.test.ts src/__tests__/uw-referral-reason-sort.test.ts src/__tests__/uw-referral-routes.test.ts --maxWorkers=1`
  - `npm run test:integration --workspace=server -- src/__tests__/uw-referral.integration.test.ts src/__tests__/coverage-integrity.integration.test.ts src/__tests__/quote-bind-aggregation.integration.test.ts src/__tests__/quote-bind-internal-consistency.integration.test.ts --maxWorkers=1`
  - `npm run typecheck --workspace=frontend`
  - `node node_modules/typescript/bin/tsc -p server/tsconfig.json --noEmit`
  - `git diff --check` (passed).
- An exploratory full integration run was stopped to reduce machine contention;
  it was not green (unrelated AI-audit tenant-isolation test failed). Earlier
  duplicate wizard runs were cancelled; saturated runs timed out without any
  timeout or assertion relaxation. Do not treat those runs as release evidence.
- No E2E execution here: parent owns the isolated browser run and phone audit.
  Wizard/CSS edits occurred after parent build session 77440 started; rebuild
  its image to include the final code. Fresh independent review remains pending.
- Policy-service callers run in caller-owned transactions. Tests retain a newly
  opened referral by catching the domain rejection inside their setup
  transaction, then test rejected retries and explicit decisions separately;
  this change does not alter existing transaction/rollback boundaries.
- No commits, pushes, merges or deployment performed.
