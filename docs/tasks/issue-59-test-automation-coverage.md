# Task Note: Test Automation Coverage — Compliance And Financial Logic

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/59
- Pull request:

## Summary

Issue #59 asks for expanded regression coverage across policy transaction and
framework workflows. A full audit of `server/src/**/__tests__`,
`frontend/src/**/__tests__`, and `e2e/` found that quote, bind, cancellation,
reinstatement, rewrite, renewal, non-renewal, customer portal, RBAC, forms,
notifications, idempotency, and compliance-admin flows already have coverage
added by recently merged PRs (#86-90, #49, #50). The one genuine, high-value
gap found was `server/src/lib/policy-compliance.ts`: OFAC screening, state
eligibility, quote expiry, and short-rate return-premium calculation had zero
direct unit tests, even though they are P0 compliance/financial logic and the
return-premium math directly affects money returned to policyholders. This
change adds that missing unit coverage.

## Important Files

- `server/src/lib/__tests__/policy-compliance.test.ts`: new unit tests for
  `normalizeOfacName`, `checkQuoteExpiry`, `computeShortRateEarnedPct`,
  `computeReturnPremium` (all four return-premium methods), `checkStateEligibility`
  (default-block, ACTIVE, SUSPENDED/CLOSED/FILING_PENDING), and `screenOfac`
  (clear, fuzzy potential-hit, prior-BLOCKED carry-forward, prior-CLEARED
  auto-clear) using a mocked `QueryFn`, following the same fake-query pattern
  as `server/src/services/__tests__/document-generation.service.test.ts`.

## Behavior Rules

- `computeReturnPremium` must keep `returnPremium + earnedPremium === fullPremium`
  for PRO_RATA and SHORT_RATE methods — this is now asserted directly.
- `checkStateEligibility` blocks by default when no eligibility record exists
  ("not configured" is a deliberate fail-closed default, not a bug).
- `screenOfac` disposition carry-forward: a prior reviewer `BLOCKED` decision
  always forces `CONFIRMED_HIT` even without a fresh SDN match; a prior
  `CLEARED` decision auto-clears a fresh fuzzy match. Both behaviors are now
  regression-tested so future changes to the screening logic can't silently
  break compliance carry-forward.

## Automated Tests

- Tests added: `server/src/lib/__tests__/policy-compliance.test.ts` (23 tests).
- Test layer used: server unit tests with a mocked `QueryFn` (no database
  required) — appropriate per `docs/TEST_PLAN.md` since this is pure/near-pure
  domain logic with injectable query dependencies.
- Why this layer is enough: `screenOfac` and `checkStateEligibility` take a
  `QueryFn` parameter, so their branching logic (SDN matching, disposition
  carry-forward, eligibility status handling) is fully exercisable without a
  live Postgres instance; existing DB integration tests
  (`compliance-admin.integration.test.ts`) already cover the real-schema path.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

## Follow-Ups Or Risks

Issue #59's full scope is large (quote through non-renewal, search, timeline,
RBAC breadth, Playwright E2E). This PR intentionally does not claim full
closure — it fills the specific gap identified above. Remaining gaps found
during the audit, left as follow-up work rather than attempted here:

- **Out-of-sequence endorsement handling does not exist in the codebase yet**
  (no `outOfSequence`/`out-of-sequence` implementation found outside an
  unrelated string match in `server/src/lib/ai-ml.ts`). This is really the
  scope of issue #52 ("Extend out-of-sequence handling beyond endorsements")
  — tests can't be written for behavior that isn't implemented.
- Policy search (`store.searchPolicies`, used by `server/src/routes/policies.routes.ts`)
  is only exercised indirectly via the frontend `SearchPage.test.tsx` and the
  legacy-store fallback tests; a direct DB-backed integration test for the
  primary search path would be a good next slice.
- No dedicated frontend test exists for `PolicyViewPage`'s timeline rendering
  (actor, processed vs. effective date, transaction type/number). The pure
  timeline-shaping helper is covered by `server/src/lib/__tests__/policy-timeline.test.ts`,
  but the page-level rendering is not.
- RBAC-denial coverage exists per-feature (`rbac.test.ts`,
  `auth.test.ts`, `RouteGuards.test.tsx`, plus denial cases inside the
  compliance-admin/notification-template/document-storage integration tests)
  but there is no single cross-route negative-permission matrix; a future pass
  could add one.
- Playwright E2E (`e2e/workflows.spec.ts`, `e2e/auth-route-access.spec.ts`)
  was not extended in this change; expanding it to a servicing-transaction
  journey (e.g. bind → endorse → cancel) would be a good follow-up given the
  issue explicitly asks for critical-journey E2E coverage.
