# First Good Tasks

This guide helps new contributors choose useful starter work without needing
deep project history. Start with `docs/PROJECT_CONTEXT.md`,
`docs/DEVELOPER_SETUP.md`, and `docs/AI_CONTRIBUTOR_PROCESS.md`, then pick the
smallest task that matches your comfort level.

For any behavior change, include automated tests in the same pull request. For
documentation-only work, explain why tests are not applicable in the PR testing
notes.

## Before You Start

Recommended setup:

```bash
npm install
npm run build
npm run test
npm run typecheck
```

Useful references:

- `AGENTS.md`: first-stop guidance for AI coding agents.
- `docs/PROJECT_CONTEXT.md`: architecture, domain, and module map.
- `docs/TEST_PLAN.md`: which test layer to use.
- `docs/AI_CONTRIBUTOR_PROCESS.md`: task notes and AI-readable handoff rules.
- `docs/tasks/TEMPLATE.md`: task-note template for non-trivial changes.

## Documentation Tasks

Good candidates:

- Improve setup notes where a command, prerequisite, or troubleshooting step is
  unclear.
- Add examples to API, product-pack, deployment, or contributor docs.
- Link related roadmap issues from docs so contributors can find the right
  parent context.

Expected files:

- `README.md`
- `docs/*.md`
- `docs/tasks/*.md`

Validation:

```bash
npm run typecheck
```

Use `N/A - documentation-only` in the PR testing notes when no runtime behavior
changed.

## Test Tasks

Good candidates:

- Add missing unit tests for policy date/status helpers.
- Add frontend component tests for empty/error/permission states.
- Add API tests for validation, RBAC denial, tenant mismatch, or response
  envelopes.
- Add regression tests for bugs found in open issues.

Expected files:

- `server/src/**/__tests__/*.test.ts`
- `frontend/src/**/__tests__/*.test.tsx`
- `docs/TEST_PLAN.md` when adding a new testing pattern.

Validation:

```bash
npm run test:server
npm run test:frontend
npm run test
```

## Frontend Tasks

Good candidates:

- Improve loading, empty, and error states in an existing page.
- Tighten permission-gated navigation or route guard behavior.
- Add small UI improvements to search, policy view, customer portal, or admin
  screens using existing component patterns.

Expected files:

- `frontend/src/features/**`
- `frontend/src/api/**`
- `frontend/src/components/**`

Validation:

```bash
npm run build:frontend
npm run test:frontend
npm run typecheck
```

## Backend API Tasks

Good candidates:

- Add validation and consistent error responses to one route area.
- Improve tenant/RBAC guard coverage in an existing endpoint.
- Add small read-only endpoints that follow existing route/service patterns.
- Document API response shapes after behavior changes.

Expected files:

- `server/src/routes/**`
- `server/src/services/**`
- `server/src/lib/**`
- `server/src/openapi.ts`
- `server/src/**/__tests__/*.test.ts`

Validation:

```bash
npm run build:server
npm run test:server
npm run typecheck
```

## Product Pack Tasks

Good candidates:

- Add or refine coverage/rate YAML examples for an existing product.
- Improve product metadata examples in `products/` or tenant overrides.
- Add rating tests for a product path.

Expected files:

- `products/<product>/coverage.yaml`
- `products/<product>/rates.yaml`
- `tenants/sample-carrier/**`
- `server/src/services/__tests__/rating.service.test.ts`

Validation:

```bash
npm run test:server
npm run build
```

## Dev Tooling Tasks

Good candidates:

- Improve a script error message.
- Add a non-destructive validation script for docs, product packs, or GitHub
  planning files.
- Improve CI documentation when workflow behavior changes.

Expected files:

- `scripts/**`
- `.github/workflows/**`
- `.github/*.yml`
- `docs/DEVELOPER_SETUP.md`
- `docs/TEST_PLAN.md`

Validation:

```bash
npm run build
npm run test
npm run typecheck
```

For CI-related changes, also document which GitHub Actions job should prove the
change.

## Starter Issue Labels

Look for these labels in GitHub:

- `good first issue`: intended for first-time contributors.
- `help wanted`: maintainers welcome community implementation.
- `type:docs`: documentation-heavy work.
- `type:test`: automated test coverage work.
- `needs-analysis`: clarify scope before coding.

If an issue is broad or marked as an epic, treat it as planning context. Pick or
create a smaller implementable task before opening a code-heavy pull request.
