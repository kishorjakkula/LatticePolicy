# Task Note: Coverages must belong to the product (WP-0002)

## Links

- Work package: `docs/work/WP-0002-intermittent-personal-auto-quote-premium-step/`

## Summary

A personal auto quote intermittently picked up the homeowners coverage set,
was rated with it and, once, bound. Cause: the quote wizard kept whichever
product configuration response arrived last, and the server never checked
coverage codes against the product. Fixed in the wizard (stale responses
ignored, product change confirmed) and on the server (undefined codes refused at
every transaction), with a read-only Coverage Integrity report.

## Important Files

- `server/src/services/product-rules.service.ts`: `coverageViolations`, included
  in `productRuleViolations`; `assertCoveragesDefined` for issue.
- `server/src/services/lifecycle.service.ts`, `endorsement.service.ts`: pass the
  policy's current payload so carried codes are allowed on changes.
- `server/src/services/coverage-integrity.service.ts`, route
  `GET /api/v1/admin/dashboard/coverage-integrity`.
- `frontend/src/features/wizard/QuoteWizard.tsx`: `configRequestRef` guard in
  `loadConfig`, `CoverageSelector` product match, `ProductChangeDialog`,
  `coverageErrorMessage`.
- `frontend/src/features/admin/OperationsDashboardPage.tsx`: Coverage Integrity panel.
- `e2e/support/products.ts`: homeowners fixture uses coverage `A` (was the undefined `DWELLING`).

## Behavior Rules

- Coverage codes come from the payload's pinned product version, else the current definition.
- New business refuses every undefined code; endorsement, renewal and rewrite refuse only codes the change introduces.
- The report never changes data; correcting real policies is a carrier decision.
- The wizard never renders or applies a configuration for another product.

## Automated Tests

- Server unit: `product-rules-coverage.test.ts` (7).
- Server integration: `coverage-integrity.integration.test.ts` (5) on PostgreSQL with RLS.
- Frontend: `productCoverageGuard.test.tsx` (4), `CoverageIntegrityPanel.test.tsx` (2).
- Playwright: smoke spec repeated in parallel (see the work package).

## Validation

```bash
npm run test --workspace=server
npm run test:integration --workspace=server   # fresh database
npm run test --workspace=frontend
```

## Follow-ups

- The wizard's rating step for a renewal or rewrite rates through `POST /quotes`
  without the policy's current payload, so a legacy undefined code must be
  removed there before rating; the final renewal or rewrite transaction allows
  carried codes as designed.
