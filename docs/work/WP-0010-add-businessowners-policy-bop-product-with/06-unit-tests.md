# Unit and integration tests — WP-0010

## Tests added

Server unit (`server/src/`):
- `lib/__tests__/businessowners-rating.test.ts`: pack, golden prices and factors, B09-B12.
- `lib/__tests__/product-package.test.ts`: package rules, terms and scope, B04-B08 and B30.
- `services/__tests__/businessowners-*.test.ts`:
  - authorization;
  - quote and route actor;
  - intake mapping;
  - document tokens, templates, seeding and edition history.
- `__tests__/customer-normalize.test.ts`: a blank coordinate or share stays missing.

Database (`server/src/__tests__/`):
- `businessowners-demo.integration.test.ts`: opt-in, concurrent idempotent setup, referral and decline rules, no overwrite of edited rows, real issue flow, B14-B16 and B21-B22.
- `businessowners-lifecycle.integration.test.ts` (new):
  - owner and tenant quote, bind and issue with stored terms;
  - endorse, with re-derived aggregates;
  - refusals for a dropped required part, inflated terms and a second premises;
  - a referral for a servicer without a grant;
  - cancel and reinstate, renew, rewrite, non-renew;
  - tenant scoping.

  This covers B27-B31.
- `services/__tests__/businessowners-authorization.integration.test.ts`: cross-tenant, role and lock behavior, B18-B20.

Frontend: `features/wizard/__tests__/businessowners.test.tsx`, `features/wizard/__tests__/coverageDefaults.test.ts`, `features/policies/__tests__/BusinessownersPolicyDetails.test.tsx` and `features/submissions/__tests__/SubmissionPackageTerms.test.tsx` (B03-B04, B07-B08, B32).

Browser: `e2e/businessowners.spec.ts`, mocked API, 1440px and 390px (B32-B33).

## Results

- `cd server && npx vitest run`: 107 files, 1,155 passed, 0 failed.
- `cd frontend && npx vitest run`: 95 files, 624 passed, 0 failed.
- `cd server && npm run test:integration` on a fresh disposable `lattice_policy_integration` database (Postgres 15, `TENANT_RLS_ENFORCED=true`): 47 files, 373 passed, 0 failed.
- `npx playwright test -c playwright.businessowners.config.ts`: 2 passed.
- `npm run typecheck`: clean.

One existing test, `policy-lifecycle.integration.test.ts`, timed out once while a browser run shared the machine. It passed alone and in the clean full run above.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| REQ-1 | carrier-pack.test (core codes), businessowners.test, e2e spec, contract schema via businessowners-intake.test |
| REQ-2 | product-package.test, businessowners.test, lifecycle (owner/tenant, building refusals) |
| REQ-3 | product-package.test (limits/deductibles/terms), businessowners-rating.test, lifecycle (re-derived aggregates) |
| REQ-4 | businessowners-intake.test, product-package.test, businessowners.test |
| REQ-5 | businessowners-rating.test (golden 1,800 / 800, factors, minimum), lifecycle (renewal premium unchanged) |
| REQ-6 | businessowners-demo (refer/decline rules, required fields), lifecycle (authority referral), uw fallback refusal |
| REQ-7 | businessowners-authorization.service/.integration, businessowners-quote-authorization, quote-route |
| REQ-8 | businessowners-demo (idempotent, concurrent, no overwrite), businessowners-intake |
| REQ-9 | businessowners-document-tokens/templates/seeding/history |
| REQ-10 | full unit, integration and typecheck runs above; e2e spec |
