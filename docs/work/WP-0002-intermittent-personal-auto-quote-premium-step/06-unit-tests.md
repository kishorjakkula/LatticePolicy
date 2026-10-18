# Unit and integration tests — WP-0002

## Tests added

- `server/src/services/__tests__/product-rules-coverage.test.ts` (7)
- `server/src/__tests__/coverage-integrity.integration.test.ts` (7: adds renewal/rewrite and wizard cancellation; report isolation with records in both tenants)
- `frontend/src/features/wizard/__tests__/productCoverageGuard.test.tsx` (8: adds the out-of-order response guard, the homeowners defaults condition, dialog focus and Tab trap)
- `frontend/src/features/admin/__tests__/CoverageIntegrityPanel.test.tsx` (3)
- Updated: `OperationsDashboardPage.test.tsx` (mock for the new panel's hook)

## Results

After the code review fixes: server unit 673 passed; frontend 273 passed;
server integration (fresh PostgreSQL, `TENANT_RLS_ENFORCED=1`) 174 passed.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| REQ-1 | CoverageSelector shows loading for another product's configuration; defaults only from the selected product |
| REQ-2 | Product change dialog: wording, focus, Escape keeps, Change applies |
| REQ-3 | Unit: codes named with paths, unselected entries, pinned version, carried codes, unknown products, bind/issue assertions. Integration: rate refused/allowed, bind re-check, issue refused, endorsement carries but cannot introduce |
| REQ-4 | Server refusal (premium never computed with foreign coverages); Playwright Premium step check |
| REQ-5 | Report lists per tenant, does not modify, 403 for agents, 200 for admins; panel list and empty state |
| REQ-6 | Playwright repetition (automation stage) |
