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
- `POST /quotes` accepts `policyId` (policy transactions in the wizard) so the
  rating step carries codes already on the policy; this replaces the earlier
  "known limit".

## Checks run

- `npx tsc` server and frontend: clean.
- Server unit: 673 passed. Frontend: 268 passed.
- Server integration on a fresh PostgreSQL with RLS: 172 passed (after the two fixture fixes).

## Code review fixes (return from `07-code-review.md`, commit b6ed111)

- Blocker: homeowners auto-defaults build only from homeowners' own
  configuration (`homeownersDefaultsReady`); every product change clears the
  previous configuration and risk form immediately.
- Cancel, renew and rewrite in the wizard rate with the policy's context
  (`POST /quotes?policyId=`), so codes already on the policy are carried.
- Integrity report: candidates selected in SQL against the codes common to
  every product version (current and pinned), no scan cap, correct latest
  policy version, accurate total; own rate limit.
- Dialog: stable callbacks, focus no longer jumps on re-render, Tab trapped.
- Auto-applied homeowners defaults no longer count as agent data for the dialog.
- In-memory renew/rewrite carry codes like the database path.
- Panel uses `StatusBadge` and product names.
- Accepted: drafts stay unchecked by design (rate, bind and issue refuse).
- Tests added for the stale-response guard, the homeowners condition, dialog
  focus, renewal, rewrite, cancellation and report isolation.
