# Task Note: Auto-Compute Reinsurance Placement On Bind And Servicing Transactions

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/223
- Pull request:

## Summary

`computePlacementForTransaction` (issue #61) was previously only reachable
through the on-demand admin compute API — nothing in the actual policy
lifecycle called it, so the bordereaux (#62) and exposure aggregation (#63)
treaty/program reporting would show "Unplaced" for virtually every real
policy. This change wires it into bind, endorsement, renewal, and rewrite via
a new non-throwing wrapper, `computePlacementForTransactionSafely`.

## Important Files

- `server/src/services/reinsurance.service.ts`: added
  `computePlacementForTransactionSafely`, a wrapper around
  `computePlacementForTransaction` that catches any error, logs it via
  `logger`, and resolves to `[]` instead of propagating. This is the only
  entry point the lifecycle services call — none of them call
  `computePlacementForTransaction` directly.
- `server/src/services/quote-bind.service.ts`: calls the safe wrapper inside
  the bind transaction, after `createCommissionHandoffEvent` and before the
  quote is marked `Converted`.
- `server/src/services/endorsement.service.ts`: calls it at the end of
  `executeEndorsement`, after the commission handoff event.
- `server/src/services/lifecycle.service.ts`: calls it at the end of
  `renewPolicy` and `rewritePolicy`, same placement relative to the existing
  commission handoff call.
- `docs/REINSURANCE_MODEL.md`: replaced the "Deliberately Deferred: Automatic
  Lifecycle Wiring" section with "Automatic Lifecycle Wiring" describing the
  new behavior, the non-blocking error-handling guarantee, and why
  cancellation/reinstatement/non-renewal don't recompute placement.

## Behavior Rules

- Reinsurance placement computation must never fail or block the primary
  policy transaction it's attached to. Any error inside
  `computePlacementForTransaction` (bad data, unexpected DB state, a future
  bug in the matching logic) is caught, logged, and swallowed by
  `computePlacementForTransactionSafely`. Do not call
  `computePlacementForTransaction` directly from a lifecycle service — always
  go through the safe wrapper.
- "No applicable treaty/facultative arrangement" continues to be represented
  as zero `policy_reinsurance_placements` rows for that transaction, matching
  the existing convention used by the exposure service's "Unplaced (Direct)"
  labeling (issue #63) — no new placement-type value or sentinel row was
  added.
- Cancellation, reinstatement, and non-renewal do not recompute placement:
  they don't change product/state/effective-date, the inputs
  `computePlacementForTransaction` matches on, so there's nothing new to
  compute for those transaction types.
- The on-demand admin compute API and its RBAC (`admin.reinsurance.manage`)
  are unchanged; this change is purely additive automatic invocation.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/reinsurance.service.test.ts` — new test
    proving `computePlacementForTransactionSafely` resolves to `[]` instead
    of throwing when the underlying compute call fails (verified against a
    real internal "DB not initialized" error, not a mock).
  - `server/src/__tests__/reinsurance-lifecycle-wiring.integration.test.ts`
    (new) — three DB-backed integration tests: (1) binding a
    personal-auto/CA policy against a matching treaty produces a real
    `TREATY` placement row automatically, with no call to the admin compute
    API; (2) binding a homeowners/TX policy with no applicable treaty leaves
    zero placement rows and bind still succeeds; (3) an endorsement on a
    bound policy computes its own placement row for the new transaction
    without duplicating or disturbing the original bind transaction's row.
- Test layer used: unit test for the non-throwing wrapper contract; DB-backed
  integration tests for the real wiring, since the value being proven is
  cross-service (bind/endorsement calling into the reinsurance service and
  persisting real rows), not something a unit test with mocks would
  meaningfully demonstrate.
- Why this layer is enough: the pure-logic pieces (treaty matching, share
  validation) already have unit coverage from issue #61; what was missing and
  risky here specifically was proof that the automatic call actually happens
  and actually persists, which requires real service calls against a real
  database.

## Validation

```bash
npm run build       # clean
npm run test        # 101 frontend + 245 server passing (1 new unit test)
npm run typecheck   # clean
```

`npm run test:integration` / `sh scripts/test-integration.sh` could **not**
be run in this environment: Docker's local image/metadata store is corrupted
(`containerd` blob-store and bolt-db I/O errors on `docker pull`/`docker run`),
a recurring host-level issue in this session's environment, not something
caused by or fixable from this change. The three new integration tests are
written, typecheck cleanly, and follow the exact same patterns (tenant/quote
seeding, `createOrRateQuote`/`bindQuote`/`executeEndorsement` calls) as the
already-passing `quote-to-bind.integration.test.ts` and
`reinsurance.integration.test.ts` — but they have not been executed against a
real Postgres instance. **Recommend running
`sh scripts/test-integration.sh` in CI or a clean environment before merge**
to confirm these three tests actually pass.

## Follow-Ups Or Risks

- If `sh scripts/test-integration.sh` surfaces a failure in the three new
  tests once Docker is available, the most likely causes are: (a) the
  homeowners quote payload's exact required fields not matching what
  `createOrRateQuote` expects for that product (only checked against
  `contracts/quote.request.schema.json`/rating code by inspection, not by
  running it), or (b) the treaty's `state_codes`/`product_codes` array
  matching semantics differing subtly from what's assumed. Fix forward in a
  follow-up commit rather than treating the wiring itself as suspect if so —
  the wiring logic itself is a 4-line call in each service, easy to verify
  independently of the test fixtures.
- Backfilling placements for policies bound before this change requires using
  the existing on-demand admin compute API per policy/transaction; no bulk
  backfill job was added (out of scope for this issue).
