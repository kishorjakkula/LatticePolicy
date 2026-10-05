# Task Note: API Validation And RBAC Tests For The Referral Decide Route

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/178
- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/196

## Summary

`PATCH /api/v1/uw/referrals/:referralId/decide` had no route-level automated
coverage. `uw-referral.integration.test.ts` exercises the referral workflow
through the service layer (`decideReferral`) against a real database, so the
guards that sit in front of that service — the `uw.referrals.decide` permission
check, the `decision` payload whitelist, and the tenant scope applied to the
transaction — were only proven indirectly.

This adds a route-layer test that mounts `uwRoutes` behind the same middleware
order the API uses in `app.ts`, with the database and referral service stubbed.
No product code changed.

## Important Files

- `server/src/__tests__/uw-referral-routes.test.ts`: the new test.
- `server/src/routes/uw.routes.ts`: route under test; the decide handler
  validates `decision` before checking database mode and delegates to
  `decideReferral` inside `withTenantTx`.
- `server/src/auth.ts` (`requirePermission`, `hasPermission`,
  `hydratePermissions`): permission gate being asserted.
- `server/src/lib/rbac.ts`: default role map that grants `underwriter` both
  `uw.referrals.read` and `uw.referrals.decide`, and grants `agent` neither.
- `server/src/tenancy.ts` (`tenancyMiddleware`, `requireTenant`): derives the
  tenant from `X-Tenant` and rejects a request tenant that does not match the
  caller's token tenant.

## Behavior Rules

Rules the test pins down, which future contributors must preserve:

- Deciding a referral requires `uw.referrals.decide`. `uw.referrals.read` grants
  access to the referral queue but must never authorize a decision.
- The permission check runs before payload validation, so an unauthorized caller
  gets `403 FORBIDDEN` rather than a `400` that would confirm the payload shape.
- An unauthenticated request gets `401 UNAUTHENTICATED`.
- `decision` is a closed set — `Approved`, `Declined`, `InfoRequested` — matched
  after trimming and case-sensitively. Anything else is `400 INVALID_DECISION`
  and must not reach `decideReferral`.
- The decision runs inside `withTenantTx` for the request tenant, and the same
  tenant id is passed to `decideReferral`.
- A request whose `X-Tenant` differs from the caller's token tenant is rejected
  with `403 TENANT_MISMATCH` before any transaction opens.

## Automated Tests

- Tests added or updated: `server/src/__tests__/uw-referral-routes.test.ts`
  (14 cases across authorization, request validation, and tenant scoping).
- Test layer used: API/route tests via `supertest`, with `../db.js` and
  `../services/uw-referral.service.js` mocked.
- Why this layer is enough: the behavior under test is middleware and handler
  logic that runs before persistence. The route test asserts it without a
  database, so it runs in the default unit suite; the DB-backed decision
  workflow stays covered by `uw-referral.integration.test.ts`.

Two details worth knowing when extending this file:

- Role-based test identities (`underwriter`, `agent`) resolve permissions
  through the real in-memory role map, which `resolvePermissionsForRoles` uses
  when `getDb()` returns `null`. Those cases therefore run in no-database mode.
- Token-scoped identities carry explicit `permissions` and no roles.
  `hydratePermissions` returns early when the user has no roles, so their
  permissions survive intact and the assertions do not depend on how RBAC rows
  are stored. Those cases are used wherever the request must reach the service.

The guards were verified as load-bearing: removing the `requirePermission`
wrapper and the `decision` whitelist from the decide handler fails 8 of the 14
cases.

## Validation

```bash
npm run test:server
npm run test:frontend
npm run typecheck
npm run build
```

## Follow-Ups Or Risks

- The sibling `/approve` and `/decline` aliases and the `assign` and `comments`
  endpoints on the same router still have no route-level validation or RBAC
  coverage. They follow the same pattern and could reuse this file's helpers.
- `server` has no `typecheck` script, so `npm run typecheck` skips it; the
  server, including this test file, is typechecked by `npm run build`.
