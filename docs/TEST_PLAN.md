# LatticePolicy Test Automation Plan

This plan organizes automated testing by risk and execution cost. Keep fast unit and component tests in Vitest, then add DB-backed integration tests and Playwright E2E tests as separate layers.

## Test Layers

### 1. Unit Tests

Purpose: verify pure domain logic and helpers without network, Docker, or database dependencies.

Initial targets:

- Rating engine product paths:
  - `personal-auto`
  - `homeowners`
  - `cyber`
  - `commercial-auto`
  - `professional-liability`
- Date and premium utilities.
- Policy status and transaction status helpers.
- JSON patch and timeline helpers.
- RBAC permission catalog and role resolution fallback logic.

Location:

- Server: `server/src/**/__tests__/*.test.ts` or colocated `server/src/<area>/__tests__/*.test.ts`
- Frontend: `frontend/src/**/__tests__/*.test.tsx`

### 2. API Tests Without Database

Purpose: verify Express behavior, validation, auth guards, response envelopes, and fallback mode.

Targets:

- Health endpoint.
- Login and MFA flow.
- Tenant required and tenant mismatch behavior.
- Quote create/rate fallback path.
- Quote draft create/update fallback path.
- Policy read/search fallback path.
- RBAC-protected route responses.

Pattern:

- Use Vitest and Supertest.
- Mock heavy integrations.
- Keep each test file scoped to one route area.

### 3. Frontend Component Tests

Purpose: verify route guards, permissions, state, and critical form flows with jsdom.

Targets:

- Route guard redirects by role.
- Navigation/menu visibility by permission.
- Quote wizard validation and submit behavior.
- Search filters, pagination, and empty states.
- Policy view summary/timeline rendering.
- Customer portal safe-view rendering.
- Admin user/security/forms/customer screens.

Pattern:

- Use Testing Library.
- Mock API modules at the feature boundary.
- Assert user-visible behavior rather than implementation details.

### 4. DB-Backed Integration Tests

Purpose: verify migrations, PostgreSQL persistence, tenant scope, and real policy lifecycle writes.

Targets:

- Migrations run cleanly on an empty database.
- Quote -> bind -> policy projection.
- Policy version, transaction, rating, risk, coverage persistence.
- Endorse preview and issue.
- Cancel and reinstate.
- Customer-policy link and portal scope.
- RBAC rows and permission resolution.
- Cache invalidation when admin/config resources mutate.

Pattern:

- Use a disposable Postgres instance.
- Keep data per test tenant.
- Avoid relying on shared local Docker volumes.

### 5. End-To-End Tests

Purpose: verify browser workflows across frontend, API, database, and cache.

Recommended tool:

- Playwright.

Initial E2E scenarios:

- Admin login -> dashboard/search loads.
- Agent login -> create quote -> rate -> bind -> view policy.
- Underwriter login -> review referral.
- Customer login -> portal list -> portal policy summary.
- Customer cannot reach admin/search/internal policy pages.
- Mobile viewport nav opens and routes correctly.

## First Milestone

Add fast tests that do not require a live database:

- Server rating product coverage tests.
- Frontend route guard permission tests.
- Frontend API client request/error tests already exist; extend only as needed.

## Second Milestone

Add API fallback tests:

- Quote create/rate.
- Quote draft create/update.
- Tenant required and mismatch.
- Customer portal scope with mocked/in-memory data.

## Third Milestone

Add Docker-backed integration tests:

- Migration smoke.
- Quote -> bind -> policy view.
- Endorsement lifecycle.
- Customer portal linked-policy scope.

## Fourth Milestone

Add Playwright E2E:

- Authentication and route access.
- Quote-to-policy happy path.
- Customer portal happy path.
- Key responsive smoke tests.

## Running Tests

```bash
npm run test:server
npm run test:frontend
npm run test
npm run typecheck
```

The root `npm run test` command runs local Vitest on Node 20. If the active
local Node version is not 20 and Docker is available, it falls back to the
Docker runner automatically.

You can also run the full suite in Docker directly:

```bash
npm run test:docker
```

The Docker test runner uses `node:20-alpine` with an isolated `node_modules`
volume so local machine Node versions and native optional dependencies do not
affect test results.

For Docker-backed manual smoke checks:

```bash
docker compose up -d --build
curl http://localhost:3300/health
npm run smoke --workspace=server
npm run smoke:transactions --workspace=server
```
