# Task Note: API Contract Validation And Drift Checks

## Links

- Issues: #85, #91, #105
- Pull request: #333

## Summary

This change adds a focused contract tooling slice for JSON Schema validation and
OpenAPI drift checks. It does not complete every backlog item in #85, #91, or
#105, but it creates a tested foundation: contracts under `contracts/` are
compiled with AJV, validation errors are normalized for API/client tooling, and
the generated OpenAPI spec is tested for trace-aware common error contracts.

## Important Files

- `server/src/contracts.ts`: loads JSON schemas from `contracts/`, compiles
  them with AJV 2020-12, and exposes structured validation results.
- `server/src/openapi.ts`: documents reusable `ErrorResponse`,
  `ValidationErrorResponse`, `IdempotencyConflictErrorResponse`, and
  `ContractValidationError` schemas.
- `server/src/__tests__/contracts.test.ts` and
  `server/src/__tests__/openapi-contract.test.ts`: verify JSON Schema behavior
  and guard complete OpenAPI route/error-contract coverage.
- `package.json` and `server/package.json`: add `test:contracts` for a fast
  contract-only check.

## Behavior Rules

- Portable quote contract validation still requires `tenantId` because the
  schema represents import/export payloads.
- Runtime quote API validation remains compatible with `X-Tenant` based
  requests by validating an augmented copy in `validateQuote`.
- Contract validation errors must include `path`, `keyword`, `message`, and
  `schema`.
- OpenAPI operations should keep reusable JSON error responses for standard
  error statuses, including validation and idempotency conflict responses with
  trace metadata.

## Automated Tests

- Tests added or updated: `server/src/__tests__/contracts.test.ts` and
  `server/src/__tests__/openapi-contract.test.ts`
- Test layer used: server unit tests
- Why this layer is enough: the change is pure contract/OpenAPI generation
  logic and does not require a database, tenant store, or browser.

## Validation

```bash
npm run test:contracts
npm run build:server
```

## Follow-Ups Or Risks

- #85 still needs route/service adoption of structured contract errors where
  API compatibility allows it.
- #91 still needs broader developer-facing API documentation/examples beyond
  the generated OpenAPI schemas.
- #105 still needs broader route/schema drift coverage if contributors want
  every route module to be compared against Express registration.
