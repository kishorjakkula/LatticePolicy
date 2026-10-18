# Unit and integration tests — WP-0002

## Tests added

- `server/src/services/__tests__/product-rules-coverage.test.ts` (7)
- `server/src/__tests__/coverage-integrity.integration.test.ts` (9: adds renewal/rewrite and wizard cancellation; report isolation with records in both tenants; policy id scoped to a policy transaction of the same product; missing pinned version reported)
- `frontend/src/features/wizard/__tests__/productCoverageGuard.test.tsx` (8: adds the out-of-order response guard, the homeowners defaults condition, dialog focus and Tab trap)
- `frontend/src/features/wizard/__tests__/useProductConfiguration.test.tsx` (7, rendered hooks with controlled promises: late response, A→B→A, same product re-chosen mid-load, clearing on change, homeowners defaults only from homeowners config, reopened quote not auto)
- `frontend/src/features/admin/__tests__/CoverageIntegrityPanel.test.tsx` (3)
- Updated: `OperationsDashboardPage.test.tsx` (mock for the new panel's hook)

## Results

After the re-review fixes (88b06a4): server unit 673 passed; frontend 280
passed; server integration on the host against a disposable `postgres:15`
(`TENANT_RLS_ENFORCED=1`) 176 passed; server and frontend `tsc --noEmit` clean.
Mutation check on the hook tests: removing the stale-response check fails 2,
loosening the homeowners condition fails 1, keying the guard by product fails 1.

Note: `npm run test:integration` at the root runs inside `node:22-alpine`,
which has no Chrome, so document-rendering tests fail there locally; run
`npm run test:integration --workspace=server` with `DATABASE_URL` pointing at
a disposable database instead.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| REQ-1 | Rendered `useProductConfiguration`: late responses ignored, same product re-chosen still loads; CoverageSelector shows loading for another product's configuration; homeowners defaults only from homeowners' configuration |
| REQ-2 | Product change dialog: wording, focus, Escape keeps, Change applies |
| REQ-3 | Unit: codes named with paths, unselected entries, pinned version, carried codes, unknown products, bind/issue assertions. Integration: rate refused/allowed, bind re-check, issue refused, endorsement carries but cannot introduce |
| REQ-4 | Server refusal (premium never computed with foreign coverages); Playwright Premium step check |
| REQ-5 | Report lists per tenant, does not modify, 403 for agents, 200 for admins; panel list and empty state |
| REQ-6 | Playwright repetition (automation stage) |
