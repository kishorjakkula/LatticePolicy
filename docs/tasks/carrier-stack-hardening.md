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

## Follow-Ups Or Risks

- Row-level security is still not enforced at runtime (table-owner connection,
  no `FORCE ROW LEVEL SECURITY`). Needs a non-owner application role and a
  policy review; several policies use `current_setting('app.tenant_id')`
  without `missing_ok` and cross-tenant worker queries would need a bypass.
- `CARRIER_TENANT_ID` is optional. Make it required for managed deployments
  once existing shared environments are migrated.
- The scheduler-tick tenant filter is covered by typecheck and the worker
  path, not by a dedicated integration test.
- The integration suite is not idempotent on a reused database (7 failures on
  a second run, same on `main`); always run it on a fresh database.
