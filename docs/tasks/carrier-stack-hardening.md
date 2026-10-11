# Task Note: Carrier Stack Hardening (Tenant Pinning And Fail-Closed Tenancy)

## Links

- Issue: none yet (phase 1 of the carrier isolation and admin roles proposal)
- Pull request:

## Summary

Production is moving to one full stack per carrier. This change lets a stack be
pinned to a single carrier with `CARRIER_TENANT_ID` and closes the paths where
a request or background task could reach the database without a valid tenant
scope. With `CARRIER_TENANT_ID` unset, tenant resolution behaves as before.

## Important Files

- `server/src/config.ts`: `getPinnedTenantId()` reads `CARRIER_TENANT_ID`.
- `server/src/db.ts`: `assertTenantServed()` guards `withTenantTx`; `toRawQuery`
  no longer falls back to the shared pool.
- `server/src/tenancy.ts`: request-edge rejection (`TENANT_NOT_SERVED`) and
  default-to-pinned tenant resolution.
- `server/src/auth.ts`: login honors the pinned tenant and rejects an account
  that belongs to a different tenant than the one being signed into.
- `server/src/routes/sso.routes.ts`: pinned-tenant guard on `:tenantId`.
- `server/src/jobs/scheduler.ts`, `server/src/jobs/jobQueue.ts`,
  `server/src/jobs/worker.ts`, `server/src/asyncMessageWorker.ts`,
  `server/src/lib/rating-model-registry.ts`: background work is scoped to the
  pinned tenant.
- `server/src/routes/compliance-admin.routes.ts`: OFAC SDN import runs inside
  the tenant transaction instead of on the raw pool.
- `server/src/services/user.service.ts`: demo seed users are skipped on a stack
  pinned to a real carrier.

## Behavior Rules

- A pinned stack must never read, write, schedule, or claim work for another
  tenant id. New cross-tenant queries on the raw pool need a pinned-tenant
  filter.
- `withTenantTx` must keep rejecting an empty tenant id. Do not reintroduce an
  empty-string fallback.
- `toRawQuery` must only be given a handle from `withTenantTx`/`req.tx`.
- Unset `CARRIER_TENANT_ID` must keep legacy multi-tenant resolution for
  local/demo use.
- The OFAC SDN list stays global reference data (no `tenant_id`); the import is
  now all-or-nothing per request.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/tenant-pinning.test.ts` (new)
  - `server/src/__tests__/auth-tenant-pinning.test.ts` (new)
  - `server/src/__tests__/job-queue.integration.test.ts` (tenant-scoped claim)
  - `server/src/__tests__/compliance-admin.integration.test.ts` (OFAC import)
  - `uw-referral`, `quote-bind-aggregation`, and
    `quote-bind-internal-consistency` integration tests now call
    `decideReferral`/`listReferrals` inside `withTenantTx`, as the routes do;
    they previously relied on the removed pool fallback.
- Test layer used: server unit tests plus PostgreSQL integration tests.
- Why this layer is enough: the guards are middleware, config, and database
  access rules; no UI behavior changed.

## Validation

```bash
npm run typecheck --workspace=server
npm run test --workspace=server
npm run test:integration   # disposable PostgreSQL
```

## Row-Level Security Enforcement (second change)

- `server/migrations/058_tenant_rls_enforcement.sql`: restricted
  `lattice_tenant_rls` role, grants, policies for the four RLS-enabled tables
  that had none, and RLS on three tenant tables that had none.
- `server/src/db.ts`: `withTenantTx` runs `SET LOCAL ROLE lattice_tenant_rls`
  when `TENANT_RLS_ENFORCED` is on; `initDb` fails fast if the role is
  unusable.
- `server/src/__tests__/tenant-rls-enforcement.integration.test.ts`: proves
  cross-tenant reads return nothing and cross-tenant writes are rejected,
  that the pooled connection returns to the owner role, and that no tenant
  table is left without RLS or a policy.
- Validated by running the full integration suite twice on fresh databases,
  once with `TENANT_RLS_ENFORCED=1` and once without; both pass, and the
  Postgres log of the enforced run shows no unexpected permission or policy
  errors.

## Frontend Carrier Pinning (third change)

- `frontend/src/config.ts`: `config.carrierTenantId` from
  `VITE_CARRIER_TENANT_ID`.
- `frontend/src/api/request.ts`, `frontend/src/store/tenant.store.ts`,
  `frontend/src/features/auth/LoginPage.tsx`: a pinned build always sends the
  configured carrier and hides the organization field at login.
- Tests: `frontend/src/api/__tests__/request-tenant.test.ts`,
  `frontend/src/features/auth/LoginPage.pinned.test.tsx`, and one added case
  in `LoginPage.test.tsx`.

## Follow-Ups Or Risks

- The AWS and Azure deploy workflows do not pass `VITE_CARRIER_TENANT_ID` as
  a build argument yet.

- `TENANT_RLS_ENFORCED` is off by default. Turn it on per environment, then
  make it the default for managed deployments.
- Enforcement covers tenant transactions only. Raw-pool queries (workers'
  claim queries, login username lookup, migrations) still run as the owner.
- The enforced path is covered by integration tests, not by the Playwright
  end-to-end suite.
- `CARRIER_TENANT_ID` is optional. Make it required for managed deployments
  once existing shared environments are migrated.
- The scheduler-tick tenant filter is covered by typecheck and the worker
  path, not by a dedicated integration test.
- The integration suite is not idempotent on a reused database (7 failures on
  a second run, same on `main`); always run it on a fresh database.
