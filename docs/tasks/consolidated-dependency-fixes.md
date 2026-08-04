# Task Note: Consolidated Dependency Fixes

## Links

- Issues: #113, #114, #115, #116
- Pull request:

## Summary

This change consolidates the remaining dependency maintenance work into one
branch so the project can avoid several overlapping automation PRs. It updates
the affected frontend, server, shared tooling, and lockfile dependencies while
preserving the existing application behavior.

The Express-related dependency update widened the inferred type for route
parameters to `string | string[] | undefined`. The server now normalizes route
parameters through a shared helper before passing IDs or keys into service and
validation code.

## Important Files

- `package.json`: pins the root Playwright version used by browser tests.
- `frontend/package.json`: carries the React, React Query, AJV, form, state, and
  frontend type dependency updates.
- `server/package.json`: carries the API dependency and server type dependency
  updates.
- `package-lock.json`: keeps the npm workspace dependency graph reproducible.
- `server/src/lib/utils.ts`: contains the shared `routeParam` normalization
  helper.
- `server/src/routes/*.routes.ts`: normalizes Express route parameters before
  route logic uses them.
- `server/src/lib/__tests__/utils.test.ts`: covers scalar, repeated, and missing
  route parameter normalization.

## Behavior Rules

- Route handlers should keep treating path IDs and keys as single trimmed string
  values even when Express type definitions allow repeated parameter arrays.
- Empty or missing route parameters should normalize to an empty string so
  existing validation and not-found behavior continues to own the response.
- Dependency updates should not change tenant isolation, RBAC checks, customer
  projections, quote workflows, policy workflows, or portal routing.
- The root npm workspace lockfile remains the source of truth for installs and
  Docker builds.

## Automated Tests

- Tests added or updated: `server/src/lib/__tests__/utils.test.ts`.
- Test layer used: server unit tests plus existing API, frontend, Docker build,
  and Docker E2E coverage.
- Why this layer is enough: the new helper is deterministic and covered directly,
  while the existing route, workflow, and browser tests verify the updated
  dependency graph does not regress the main application paths.

## Validation

```bash
npm run security:audit
npm run build
npm run typecheck
npm run test
npm run test --workspace=server
docker build -f server/Dockerfile -t latticepolicy-api:deps-test .
docker build -f frontend/Dockerfile -t latticepolicy-frontend:deps-test .
npm run test:e2e:docker
```

## Follow-Ups Or Risks

- Raw `npm audit` still reports the intentionally allowed React Router
  advisories; the repository policy command `npm run security:audit` passes with
  those advisories documented as accepted.
- Playwright browser binaries must be refreshed after the version update by
  running `npx playwright install chromium` on local machines that run E2E tests.
