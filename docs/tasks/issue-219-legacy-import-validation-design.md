# Task Note: Legacy Import Validation And Staging Design

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/219
- Pull request:

## Summary

Documented the design for the one remaining real gap in issue #67's data
import framework: a policy entity commit handler. `docs/DATA_IMPORT_DESIGN.md`
covers the already-implemented lifecycle (stage/validate/review/commit/retry),
row-level error reporting, the two idempotency patterns (dedicated identity
table vs. generic `import_external_refs` ledger), tenant isolation, and — the
actual new design work — exactly how a staged policy row should be committed
by replaying the real `createOrRateQuote` → `bindQuote` → `issuePolicy`
sequence instead of writing directly to policy tables.

## Important Files

- `docs/DATA_IMPORT_DESIGN.md` (new): the design itself.

## Behavior Rules

- See `docs/DATA_IMPORT_DESIGN.md`'s "Why policy import is not an upsert"
  section — this is the key rule a future contributor must not violate:
  re-importing an already-committed policy is detected and skipped, never
  re-run through create→bind→issue a second time.

## Automated Tests

- Tests added or updated: none.
- Test layer used: documentation/design review.
- Why this layer is enough: this issue is a design task; #67 implements the
  design and carries the automated test coverage.

## Validation

```bash
npm run build
npm run typecheck
```

## Follow-Ups Or Risks

- See `docs/DATA_IMPORT_DESIGN.md`'s "Follow-up implementable issues"
  section: a `targetStatus` option for importing not-yet-issued business,
  `agency`/`producer` entity types following the customer pattern, and
  `transaction_history` import (explicitly out of scope, needs its own
  design pass).
- Issue #67 is the direct follow-up that implements this design.
