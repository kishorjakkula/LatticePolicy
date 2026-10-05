# Task Note: OpenAPI Drift Coverage For Exposure Management

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/213
- Pull request:

## Summary

`docs/tasks/issue-85-91-105-api-contract-validation.md` added the first OpenAPI
drift-check test (`server/src/__tests__/openapi-contract.test.ts`), covering
the standard error schemas and a handful of high-value quote/policy/portal
routes. Since then, several newer route families shipped with zero OpenAPI
coverage at all: exposure management (#63), reinsurance admin (#61),
bordereaux (#62), data import (#67), and admin jobs (#57/#227). None of the
`routeDefs` in `server/src/openapi.ts` mentioned any of them.

This change closes that gap for one route family: exposure management
(`server/src/routes/exposure.routes.ts`). The other four families remain a
real, explicit follow-up (see below) rather than being silently left
uncovered - do not read this PR as "the drift problem is solved."

## Important Files

- `server/src/openapi.ts`: added `Admin - Exposure` tag with the two real
  registered exposure routes (`GET /v1/admin/exposure/summary`,
  `GET /v1/admin/exposure/export.csv`). No `operationOverrides` entry was
  needed - the export route follows the same lightweight convention as the
  existing `/v1/quotes/export` and `/v1/policies/export` CSV routes, which
  also have no content-type override.
- `server/src/__tests__/openapi-contract.test.ts`: added both routes to the
  existing "high-value routes represented" list, and a new dedicated test
  (`documents the exposure management route family (issue #63) without
  drift`) with per-field assertions and descriptive failure messages, so a
  future contributor who breaks this sees exactly which field drifted
  (missing route, wrong tag, or missing error-schema ref) instead of a
  generic diff.

## Behavior Rules

- `buildOpenApiSpec()` auto-generates `400/401/403/404/409/422/500` responses
  for every route via `standardErrorResponses`, referencing `ErrorResponse`/
  `ValidationErrorResponse` (which require `traceId`). This is true for
  exposure routes too, purely by construction - it does **not** mean
  `exposure.routes.ts`'s actual implementation returns `traceId` (it
  currently returns a plain `{ code, message }` on error, like most routes
  in this codebase). This PR only adds *documentation drift* coverage
  (does the route exist in the spec, with the right tag); it does not change
  or assert anything about runtime response shape. Closing that
  documented-vs-actual gap is issue #215's scope, not this one's.
- Keep new route families' OpenAPI tags scoped and named consistently with
  the existing `Admin - <Area>` convention (`Admin - Onboarding`,
  `Admin - Customers`, etc.) rather than inventing a different naming style.

## Automated Tests

- Tests added or updated: `server/src/__tests__/openapi-contract.test.ts`.
- Test layer used: server unit test (pure function call against
  `buildOpenApiSpec()`, no server or database needed).
- Why this layer is enough: OpenAPI drift is a static-generation concern -
  the existing pattern in this file already validates it this way without
  needing to boot the app or hit a real route.

## Validation

```bash
npm run build
npm run test --workspace=server
npm run typecheck
```

## Follow-Ups Or Risks

- **Reinsurance admin, bordereaux, data import, and admin-jobs routes are
  still entirely undocumented in `server/src/openapi.ts`.** This PR
  deliberately scoped to one family to keep the change focused and avoid a
  large, hard-to-review diff; the other four are real gaps a follow-up issue
  should track explicitly rather than assuming this PR closed all of #213's
  possible scope.
- Admin-jobs routes in particular also don't return `traceId` on error,
  same as exposure - worth keeping in mind if #215 or a future contributor
  picks that family next, since the auto-generated docs will look identical
  regardless of which family actually implements the full contract.
