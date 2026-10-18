# LatticePolicy Test Automation Plan

This plan organizes automated testing by risk and execution cost. Keep fast unit and component tests in Vitest, then add DB-backed integration tests and Playwright E2E tests as separate layers.

The independent private document processor uses Node's built-in test runner:
`npm run test:document-processor`. This is included in local/Docker unit test
runs and CI. Its real Poppler/Tesseract smoke test is opt-in inside the
processor image with `RUN_OCR_SMOKE=1`; see `docs/PRIVATE_DOCUMENT_PROCESSING.md`.
CI builds that image and runs the real OCR and signed-activation smoke tests
with networking disabled, using synthetic documents only.
Model transport mocks are not extraction-quality evaluations. A selected
self-hosted model must pass a held-out, privacy-reviewed corpus before use.
The separate learning suite (`npm run test:document-learning`) covers approved
dataset contracts, leakage, exact held-out evidence/field metrics, drift,
private local HTTP execution and registration gating. Offline trainer contracts
run with `npm run test:document-training` (Python 3, no ML dependencies).
CI runs both; neither substitutes for actual GPU/model accuracy validation.

## Contributor Testing Policy

Automated tests are part of the definition of done for behavior changes. Any
new functionality or change in functionality should include automated coverage
in the same pull request.

CI runs `npm run test:coverage` and enforces the current repository baselines:
20% statements, 20% lines, 20% functions, and 15% branches in both workspaces.
Raise these thresholds as coverage grows; lowering them requires an explicit
review justification.

Choose the lowest-cost test layer that proves the behavior, then add broader
coverage when the risk crosses module, API, database, tenant, security, or user
workflow boundaries. A PR may skip new automation only when it is
documentation-only, formatting-only, or another no-behavior-change update; the
PR must explain that decision in the testing notes.

Expected mapping:

- Pure logic or validation changes: unit tests.
- API route, auth, RBAC, tenant scope, or contract changes: API tests.
- UI form, route, permission, or state changes: frontend component tests.
- Persistence, migration, lifecycle, or multi-table changes: DB-backed integration tests.
- Critical user journeys or cross-service flows: Playwright E2E tests.

When a change exposes a bug, add a failing regression test first when practical,
then make it pass with the fix.

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
- Search filters, pagination, and detail navigation work in a real browser.

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

The production policy scenario matrix is implemented in
`server/src/__tests__/production-policy-scenario-matrix.integration.test.ts`
with reusable fixtures under `server/src/__tests__/fixtures/`. Its browser
critical path is `e2e/production-policy-scenarios.spec.ts`; both suites run in
the required CI integration and Playwright jobs.

```bash
npm run test:server
npm run test:frontend
npm run test
npm run security:audit
npm run test:e2e
npm run test:e2e:isolated
npm run test:e2e:docker
npm run typecheck
```

The root `npm run test` command runs local Vitest on Node 22. If the active
local Node version is not 22 and Docker is available, it falls back to the
Docker runner automatically.

You can also run the full suite in Docker directly:

```bash
npm run test:docker
```

The Docker test runner uses `node:22-alpine` with an isolated `node_modules`
volume so local machine Node versions and native optional dependencies do not
affect test results.

For Docker-backed manual smoke checks:

```bash
docker compose up -d --build
curl http://localhost:3300/health
npm run smoke --workspace=server
npm run smoke:transactions --workspace=server
```

Playwright runs against the local Docker Compose ports by default:

- UI: `E2E_BASE_URL=http://localhost:5173`
- API: `E2E_API_BASE_URL=http://localhost:3300`
- Tenant: `E2E_TENANT_ID=sample-carrier`

`npm run test:e2e:isolated` is the recommended way to run the full suite and
is what CI runs. It starts `docker-compose.e2e.yml` (project
`latticepolicy-e2e`, UI `:5174`, API `:3301`, throwaway volumes), waits for a
database-backed health response, runs Playwright, and removes the stack. It
can run next to the local demo stack without touching demo data. Pass spec
paths or Playwright flags through, and set `E2E_KEEP_STACK=1` to leave the
stack up for debugging.

`npm run test:e2e:docker` is the older runner. It tears down the **default**
Compose project and deletes `latticepolicy_pgdata` / `latticepolicy_redisdata`,
so it wipes local demo data, and it does not set `TRUST_PROXY`, so the full
suite will hit the login (20 / 15 min) and API (600 / 15 min) rate limiters.
Use it only for a small subset of specs on a machine with no demo data to keep.

Plain `npm run test:e2e` runs against whatever is on `:5173` / `:3300`. The
suite creates policies, customers, users, and referrals, so do not point it at
a stack whose data you want to keep clean.

### Playwright after every deployment

- **Local Docker:** `npm run deploy:local` rebuilds and restarts the demo
  stack, runs the `@smoke` tests against it, then runs the full suite against a
  disposable copy of the same build. `DEPLOY_SKIP_FULL_E2E=1` stops after the
  smoke tests.
- **GitHub deploy workflows** (`deploy-aws-ecs.yml`,
  `deploy-azure-container-apps.yml`): the full suite runs against a disposable
  stack before the deploy job and blocks it on failure; after the deploy,
  `e2e-post-deploy.yml` runs the `@smoke` tests against the deployed
  environment. It needs the `E2E_TENANT_ID` variable and `E2E_PASSWORD` secret.

Only the `@smoke` subset runs against a live environment. The full suite
writes tenant-wide underwriting rules and authority grants and makes more
requests than the per-IP API rate limit (600 / 15 min) allows from one runner,
so it always runs on a disposable stack. Tag a test `{ tag: '@smoke' }` only if
it is safe to repeat on shared data: no tenant-wide configuration, and no
dependence on freshly seeded names.

### E2E suite layout

| Spec | Covers |
| --- | --- |
| `auth-route-access`, `auth-session` | UI login, bad credentials, unknown tenant, sign-out, unauthenticated redirects |
| `role-access-matrix` | Route guards per role; API 401/403, tenancy, API-docs and health access |
| `quote-wizard` | New business in the browser: product -> qualification -> insured -> risk -> coverages -> rate -> bind -> issue; step validation; draft save/resume |
| `policy-lifecycle`, `production-policy-scenarios` | Policy view, endorsement, cancellation, abandon, reinstatement, renewal, audit and as-of panels |
| `multi-product` | Quote -> bind -> issue and search for homeowners, cyber, commercial auto, professional liability |
| `underwriting-rules` | Admin-authored Refer/Decline rules, referral approval, validation, permissions |
| `underwriting-authority` | Authority grants gating bind above a premium limit, revoke, validation |
| `uw-referrals`, `pre-bind-checks` | Referral queue decisions; internal-consistency referral on prior non-payment cancellation |
| `customer-portal` | Customer-safe projection, cross-customer isolation, portal summary and documents |
| `policy-documents` | Distinct Bind/Issue packet labels; every listed document opens with nonempty PDF or worksheet content, including headless PDF downloads |
| `pilot-product-pinning` (separate pilot config) | Real mounted pack changes, pinned core/additive and absent screens, endorsement persistence, button-triggered mandatory validation, and carrier branding in administration/login, stored packets and browser worksheet PDFs |
| `dashboard-search`, `workflows` | Dashboard KPIs, quick lookup, filters, customers tab, CSV export API, sort/page-size URL state, mobile nav |
| `forms-management` | Seeded forms, draft form creation, Word template upload, template variable reference |
| `admin-users-security`, `admin-customers`, `admin-reference-config`, `admin-workflows` | Users, roles, customers and PII reveal, underwriting companies, tenant, compliance, notification templates, agency onboarding, operations dashboard, reinsurance, exposure, bordereaux, import, jobs |
| `collapsible-sections` | Sections collapse and expand keeping entered values; wizard step sections; search tab results; administration side menu collapse |
| `ui-section-standards` | UI standard audit: visits every screen, fails with a list of any section card that is not collapsible, and exercises every collapse toggle |
| `placements-rating` | Placement market workflow; rating workbench shell for the actuary role |

Shared helpers live in `e2e/support/`: `fixtures.ts` (per-test synthetic client
IP, per-worker cached sessions via `sessionFor` / `signInAs`), `api.ts` (API
setup and negative-path helpers), `wizard.ts` (wizard field and step helpers),
and `products.ts` (one clean risk per product line). `e2e/global-setup.ts`
seeds the idempotent reference data the Quote Wizard depends on.

Conventions for new specs:

- Import `test` / `expect` from `./support/fixtures`, not `@playwright/test`.
- Use `sessionFor(user)` or `signInAs(page, user)` instead of logging in per test.
- Tenant-wide configuration (underwriting rules, authority grants) must be
  scoped to a product/state no other spec uses and deactivated in `finally`.
- Use `isoDate(offset)` rather than literal dates so terms do not expire.
- A test that documents a known product defect is written with the correct
  expectation and marked `test.fixme` with a comment naming the defect; remove
  the marker in the change that fixes it. The suite currently has none.

- Radio inputs must use the shared `RadioGroup`; the frontend source audit
  enforces this across production code. The screen audit checks visible radio
  naming, alignment, and viewport bounds. Qualification alignment tests exercise
  all five core products at desktop and mobile widths. See
  [UI control standards](UI_CONTROL_STANDARDS.md).

- A new screen must be added to `SCREENS` in `e2e/ui-section-standards.spec.ts`,
  and its sections must use `CollapsibleSection`; the audit fails otherwise.

### Failure reporting

Every pull request and push to `main` runs the full suite. Failures are
reported three ways: inline annotations on the pull request (Playwright
`github` reporter), a "Playwright results" block in the workflow run summary
listing each failed or flaky test with its first error line
(`scripts/summarize-playwright.mjs`), and the HTML report and traces uploaded
as artifacts. Locally, `npm run test:e2e:report` prints the same summary for
the last run.

Use `npx playwright install chromium` before the first run on a new machine.

GitHub CI runs unit/component tests, typecheck, DB-backed integration tests,
Playwright E2E smoke, dependency audit policy, dependency review, CodeQL, and
container scanning. Keep workflow changes aligned with this test plan.
