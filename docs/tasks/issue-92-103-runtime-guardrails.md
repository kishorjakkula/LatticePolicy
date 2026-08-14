# Task Note: Runtime Guardrails

## Links

- Issues: #92, #103
- Pull request:

## Summary

Managed deployments now fail fast when production runtime configuration is
missing or unsafe. The server validates required database, auth, customer-data,
MFA, CORS, and cache settings before startup-sensitive helpers return defaults.
The frontend also rejects production builds that still point at the mock API.

## Important Files

- `server/src/config.ts`: central managed-deployment validation and secret/origin guardrails.
- `server/src/auth.ts`: avoids local demo user seeding in managed database-backed login.
- `frontend/src/config.ts`: production Vite build guardrail for mock mode and API URL.
- `.github/workflows/ci.yml`: supplies production-safe Vite settings for CI builds.
- `.env.example`, `frontend/.env.example`, `docs/CLOUD_DEPLOYMENT.md`: documents safe runtime values.

## Behavior Rules

- `NODE_ENV=production` and `DEPLOYMENT_ENV` values of `test`, `validation`,
  `staging`, or `production` are managed deployments.
- `DEPLOYMENT_ENV=local` is reserved for local Docker/demo smoke tests and keeps
  demo defaults available even when the container image sets `NODE_ENV=production`.
- Managed deployments require `DATABASE_URL`, `JWT_SECRET`,
  `CUSTOMER_DATA_KEY`, `MFA_TOKEN_SECRET`, and `ALLOWED_ORIGINS`.
- Managed secrets must be unique, non-placeholder values with at least 32
  characters.
- Managed CORS origins must be explicit HTTPS origins, not wildcard, HTTP, or
  localhost values.
- `CACHE_ENABLED` requires `REDIS_URL` in managed deployments.
- Production frontend builds require `VITE_USE_MOCK=0/false` and an absolute
  HTTPS `VITE_API_BASE_URL`, except for localhost/127.0.0.1 URLs used by local
  smoke tests.
- Local/demo mode remains available when the deployment is not managed.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/config.test.ts`
  - `server/src/__tests__/auth-demo-access.test.ts`
  - `frontend/src/__tests__/config.test.ts`
- Test layer used: server and frontend unit tests.
- Why this layer is enough: the change is runtime configuration validation and
  auth fallback branching, both of which are exercised without a live database
  or browser.

## Validation

```bash
npm run test --workspace=server -- src/__tests__/config.test.ts src/__tests__/auth-demo-access.test.ts
npm run test --workspace=frontend -- src/__tests__/config.test.ts
npm run build:frontend
npm run build:server
npm run typecheck
```

## Follow-Ups Or Risks

- Deployment workflows must continue to pass real HTTPS frontend API URLs when
  building production frontend images.
