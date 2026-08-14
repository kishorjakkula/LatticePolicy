# Task Note: API Contract Validation And OpenAPI Error Drift Checks

## Links

- Issues: #85, #91, #105
- Pull request:

## Summary

Replaced the quote contract placeholder with AJV-backed JSON Schema validation
and added OpenAPI checks for traceable error response schemas. The quote
request schema now matches the runtime API contract by using `X-Tenant` for
tenant context instead of requiring `tenantId` in the request body.

## Important Files

- `server/src/contracts.ts`: compiles and runs contract schemas with AJV.
- `contracts/quote.request.schema.json`: quote request contract used by runtime validation.
- `server/src/openapi.ts`: standard error schemas and common error responses.
- `server/src/__tests__/contracts.test.ts`: JSON Schema validation coverage.
- `server/src/__tests__/openapi-contract.test.ts`: OpenAPI drift checks.
- `docs/API.md`: documented standard error envelope and validation details.

## Behavior Rules

- API requests continue to resolve tenant context from `X-Tenant`; quote bodies
  do not need to duplicate `tenantId`.
- Contract validation errors include JSON path, keyword, message, schema source,
  and keyword params.
- Error responses should include `code`, `message`, and `traceId`; `details`
  remains optional and structured by error type.
- Docker runtime images must include `contracts/` so compiled server code can
  validate against repository-owned schemas.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/contracts.test.ts`
  - `server/src/__tests__/openapi-contract.test.ts`
- Test layer used: server unit/API contract tests.
- Why this layer is enough: the change is pure contract validation and OpenAPI
  schema generation, with existing route tests covering invalid quote behavior.

## Validation

```bash
npm run test:server
npm run build:server
npm run typecheck
```

## Follow-Ups Or Risks

- Additional request/response contracts can be moved from route-local schemas
  into repository-owned JSON Schemas incrementally.
- A future PR can add a dedicated generated OpenAPI snapshot if route metadata
  becomes richer.
