# Implementation — WP-0002

- Branch: `latticepolicy/wizard-coverage-leak`
- Task note: `docs/tasks/wp-0002-coverage-integrity.md`

## Files changed

- Server: `product-rules.service.ts` (coverage check, `issue` transaction,
  previous-payload option), `endorsement.service.ts`, `lifecycle.service.ts`
  (carried codes on endorsement, renewal, rewrite, cancellation, reinstatement;
  coverage check at issue), `coverage-integrity.service.ts` (new),
  `admin-dashboard.routes.ts` (report route).
- Frontend: `QuoteWizard.tsx` (stale-response guard for product config and form,
  `CoverageSelector` product match, product change confirmation, coverage error
  wording), `admin.api.ts`, `admin.hooks.ts`, `OperationsDashboardPage.tsx`
  (Coverage Integrity panel).
- Fixtures: `e2e/support/products.ts` (homeowners `DWELLING` → `A`),
  `server/src/__tests__/customer-portal-security.integration.test.ts` (removed an
  unselected `UM` coverage personal auto does not offer).
- Pre-existing flaky test fixed: `llm-releases.integration.test.ts` took the
  token's last `_` segment as the secret; a secret can contain `_`.
- Docs: `docs/PRODUCT_PACK_CONTRACT.md`, task note.

## Deviations from the design

- Report route is `GET /api/v1/admin/dashboard/coverage-integrity` (under the
  dashboard router, same `admin.dashboard.read` permission) instead of
  `/api/v1/admin/coverage-integrity`.
- Violations also carry `code` (alongside path, keyword, message) so the report
  and clients need not parse messages.
- The stale-response race is proven by the `CoverageSelector` product-match test
  plus repeated parallel Playwright runs, rather than a component test of the
  whole wizard (the wizard has no component harness).
- Known limit (task note): the wizard's rating step for renewal or rewrite
  checks all codes because `POST /quotes` has no policy context.

## Checks run

- `npx tsc` server and frontend: clean.
- Server unit: 673 passed. Frontend: 268 passed.
- Server integration on a fresh PostgreSQL with RLS: 172 passed (after the two fixture fixes).
