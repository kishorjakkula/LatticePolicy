# Task Note: Policy Status Filter Parity Between Database And Fallback Paths

## Links

- Issue:
- Pull request:

## Summary

`GET /policies?status=…` returned different result sets depending on whether
PostgreSQL was configured, and could return rows it then labelled with a
different status.

`derivePolicyWorkflowStatus` reports **any** non-cancelled policy whose term end
date is in the past as `Expired`, including `draft`, `quote`, `rated`, and
`bound` rows. The SQL clause builder matched those three filters on the raw
status column alone, so `status=Draft` on the database path returned expired
drafts that the same response body labelled `"Expired"`. The in-memory fallback,
which derives the status instead of querying, excluded them.

Root cause was duplication: `derivePolicyWorkflowStatus`,
`normalizePolicyStatusFilter`, and `appendPolicyStatusFilterClause` had been
copy-pasted from `server/src/lib/policy.utils.ts` into
`server/src/services/policy.service.ts`, and the two copies drifted.

The fix adds a term guard to the `Draft`/`Rated`/`Bind` SQL clauses and deletes
the duplicate helpers so the database and fallback paths share one
implementation.

## Important Files

- `server/src/lib/policy.utils.ts`: the single source of truth for the policy
  status model — status derivation, filter normalization, the SQL clause
  builder, and the in-memory matcher.
- `server/src/services/policy.service.ts`: database path. Imports the helpers and
  re-exports `derivePolicyWorkflowStatus` / `normalizePolicyStatusFilter` /
  `PolicyStatusFilter` so its public surface is unchanged.
- `server/src/routes/policies.routes.ts`: chooses the database path or the
  in-memory fallback for the same endpoint; both must agree.

## Behavior Rules

- A status filter must never return a row whose derived workflow status differs
  from the requested filter. If `derivePolicyWorkflowStatus` would label a row
  `Expired`, no other filter may match it.
- `Cancelled` is the only filter that ignores the term dates, because
  `derivePolicyWorkflowStatus` checks `cancelled` before its expiry check.
- Every other filter needs a term guard against `expirationDateColumn`.
- The database path and the in-memory fallback path are two implementations of
  one rule. Any change to one must be made in `lib/policy.utils.ts` so both move
  together.
- `policies.term_effective_date` and `term_expiration_date` are `NOT NULL`, so
  the clauses do not need `COALESCE`. That changes if the filter is ever pointed
  at a nullable date column.
- `appendPolicyStatusFilterClause` must leave `params` balanced when it does not
  emit a clause — the trailing `params.pop()` exists for that.
- `policies.status` is the `policy_status_enum` from
  `server/migrations/001_init.sql`:
  `('Quote','Draft','Bound','Issued','Cancelled','Expired')`. There is no
  `'Rated'` member, so the `Rated` filter cannot match a stored policy row —
  `Rated` is a quote/transaction-stage status, not a policy status. The filter is
  still accepted and still needs a correct clause, but it is only exercised at the
  unit layer.

## Automated Tests

- Tests added or updated:
  - `server/src/lib/__tests__/policy.utils.test.ts` — clause shape for
    `Draft`/`Rated`/`Bind`, `Cancelled` still unguarded, empty filter leaves
    `params` balanced, and a parity test that evaluates the generated SQL
    predicate against a fixture matrix and asserts it agrees with
    `matchesPolicyStatusFilter` for every filter.
  - `server/src/__tests__/policy-status-filter.integration.test.ts` — seeds
    current-term, future-term, and expired-term policies across every
    `policy_status_enum` value, then asserts `listPolicies` excludes expired rows
    from `Draft`/`Bind`, still reports them under `Expired`, never returns a row
    labelled with a different status, and agrees with the in-memory matcher for
    every filter.
- Test layer used: unit for the clause builder and cross-path parity, DB-backed
  integration for the real query.
- Why this layer is enough: the bug lives in a pure string-building helper, so a
  unit test pins it directly; the integration test proves the generated SQL
  behaves as intended against real PostgreSQL date comparison. The parity test is
  the durable guard — it is the assertion that would have caught the original
  drift.

Verified as real regression coverage: against the pre-fix clause builder, 3 unit
tests and 4 integration tests fail (`expected [ 'PSF-DRAFT-CURRENT', …(3) ] to
not include 'PSF-DRAFT-EXPIRED'`); all pass after the fix.

## Validation

```bash
npm run test
npm run typecheck
npm run build
npm run test:integration
```

## Follow-Ups Or Risks

- `server/src/lib/ai-ml.ts` holds a third copy of `derivePolicyWorkflowStatus`
  that takes an explicit `nowDateOnly`. Unifying it means threading a clock
  parameter through `lib/policy.utils.ts`; worth a separate issue.
- `frontend/src/features/policies/statusModel.ts` renders `"In Force"` where the
  server emits `"Inforced"`, and `frontend/src/api/mock.ts` carries a fourth copy
  of the derivation. Unifying those touches user-visible labels, so it was kept
  out of this change.
- `matchesPolicyStatusFilter` special-cases `Issued` with logic
  `derivePolicyWorkflowStatus` already covers. Harmless today and covered by the
  parity test; left alone to keep this change focused.
