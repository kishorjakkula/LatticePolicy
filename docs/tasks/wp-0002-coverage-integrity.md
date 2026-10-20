# Task Note: Coverages must belong to the product (WP-0002)

## Links

- Work package: `docs/work/WP-0002-intermittent-personal-auto-quote-premium-step/`

## Summary

A personal auto quote intermittently picked up the homeowners coverage set,
was rated with it and, once, bound. Cause: the quote wizard kept whichever
product configuration response arrived last, and the server never checked
coverage codes against the product. Fixed in the wizard (stale responses
ignored, Product-select change confirmed) and on the server (undefined codes refused at
every transaction), with a read-only Coverage Integrity report.

## Important Files

- `server/src/services/product-rules.service.ts`: `coverageViolations`, included
  in `productRuleViolations`; `assertCoveragesDefined` for issue.
- `server/src/services/lifecycle.service.ts`, `endorsement.service.ts`: pass the
  policy's current payload so carried codes are allowed on changes.
- `server/src/services/coverage-integrity.service.ts`, route
  `GET /api/v1/admin/dashboard/coverage-integrity`.
- `frontend/src/features/wizard/useProductConfiguration.ts`: product config and
  risk form loading with a stale-response guard; homeowners auto-defaults only
  from homeowners' own configuration.
- `frontend/src/features/wizard/QuoteWizard.tsx`: uses those hooks;
  `CoverageSelector` product match, `ProductChangeDialog`, `coverageErrorMessage`;
  policy-mode ratings send `policyId`.
- `server/src/routes/quotes.routes.ts`: `POST /quotes?transaction=…&policyId=`
  carries a policy's codes only for a policy transaction on the same product.
- `frontend/src/features/admin/OperationsDashboardPage.tsx`: Coverage Integrity panel.
- `e2e/support/products.ts`: homeowners fixture uses coverage `A` (was the undefined `DWELLING`).

## Behavior Rules

- Coverage codes come from the payload's pinned product version, else the current definition.
- New business refuses every undefined code; endorsement, renewal and rewrite refuse only codes the change introduces.
- The report never changes data; correcting real policies is a carrier decision.
- The wizard never renders or applies a configuration for another product.

## Automated Tests

- Server unit: `product-rules-coverage.test.ts` (7).
- Server integration: `coverage-integrity.integration.test.ts` (9) on PostgreSQL with RLS.
- Frontend: `useProductConfiguration.test.tsx` (7), `productCoverageGuard.test.tsx` (8), `CoverageIntegrityPanel.test.tsx` (3).
- Playwright: smoke spec repeated in parallel (see the work package).

## Validation

```bash
npm run test --workspace=server
DATABASE_URL=<disposable db> npm run test:integration --workspace=server
npm run test --workspace=frontend
```

## Follow-ups

- Company changes can also switch product but do not show the confirmation in
  staging revision 25606a0. PR #387 remains open, pending merge, deployment and
  staging verification. WP-0002 business validation is partial; Gate D remains
  pending, with no business exception or approval recorded by this correction.
- The company handler retains `draft.quoteId`, and subsequent saves update the
  same quote. A switch does not automatically create a new quote and preserve a
  separate homeowners draft; the earlier closeout explanation was unsupported.
- Drafts (save, copy, intake) are stored without the coverage check by design;
  rate, bind and issue refuse undefined codes, and the report lists such drafts.
- The report narrows candidates by the codes common to all known versions, not
  per pinned version; a product whose versions differ widely yields more
  candidates (results capped at 500, endpoint rate-limited).

## PR #386 Documentation Review Correction

- Delivery track: quick (documentation only, no new behavior or Gate A/B change).
- Corrected `12-business-validation.md` to conditional/partial validation and
  withdrew the unsupported abandoned-draft explanation. Aligned release,
  end-to-end and lessons wording; recorded this handoff in `05-implementation.md`.
- Runtime source and shared `main` were not edited. Existing test results above
  are historical evidence, not fresh application verification for this correction.
- Correction checks passed: `npm run agents:sync -- --check`,
  `npm run delivery:check` (2 packages), `npm run test:delivery` (27/27), and
  `git diff --check`. No application suites rerun for documentation-only edits.
