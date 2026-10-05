# Task Note: Production Runtime Guardrails

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/92
- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/103
- Pull request:

## Summary

Issues #92 and #103 both apply to server startup and auth behavior. The server
already had a small managed-deployment validator, but it did not treat
`NODE_ENV=production` as production-like and did not reject weak/default
runtime values. This change keeps local demo mode easy while making
production/managed runtime validation fail fast on missing or unsafe settings.

## Important Files

- `server/src/config.ts`: central runtime validation, secret helpers, allowed
  origin parsing, and managed deployment detection.
- `server/src/auth.ts`: DB-backed login no longer seeds local demo users in
  managed/production deployments.
- `server/src/__tests__/config.test.ts`: regression coverage for missing,
  unsafe, and valid production runtime settings.
- `server/src/__tests__/auth-demo-access.test.ts`: regression coverage for
  local demo login and managed demo-seeding behavior.

## Behavior Rules

- `NODE_ENV=production` is treated as a managed deployment even when
  `DEPLOYMENT_ENV`/`APP_ENV` are unset.
- Managed deployments require `DATABASE_URL`, `JWT_SECRET`,
  `CUSTOMER_DATA_KEY`, `MFA_TOKEN_SECRET`, and `ALLOWED_ORIGINS`.
- Managed deployment secrets must be non-placeholder, at least 32 characters,
  and distinct from one another.
- Managed `ALLOWED_ORIGINS` values must be explicit HTTPS origins, not `*` or
  localhost URLs.
- `CACHE_ENABLED=true` requires `REDIS_URL`.
- `DEMO_ACCESS_MODE=invite_only` still requires a non-empty demo allowlist.
- In-memory demo login remains available outside managed deployments.
- DB-backed login must not call `ensureDefaults()` in managed deployments,
  because that helper can create local demo users with password `password`.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/config.test.ts`
  - `server/src/__tests__/auth-demo-access.test.ts`
- Test layer used: server unit/API-helper tests with Vitest mocks.
- Why this layer is enough: the changed behavior is pure runtime validation
  and auth branching before persistence-specific user lookup.

## Validation

Attempted:

```bash
npm run test --workspace=server -- src/__tests__/config.test.ts src/__tests__/auth-demo-access.test.ts
```

Result: blocked locally because this shell has `npm` but no `node` binary
available (`env: node: No such file or directory`).

## Follow-Ups Or Risks

- Issue #103 also mentions frontend production build variables and broader
  deployment documentation. Those are intentionally out of scope for this
  backend-only change.
- Existing cloud/developer setup docs may need a follow-up update to reflect
  the stronger production secret length and origin rules.
