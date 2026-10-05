# Issue 302: API Contract Registry

## Summary

The API catalog now derives its complete route inventory from the mounted
Express routers. Hand-written OpenAPI definitions remain as richer metadata,
while newly registered routes receive baseline security, error, response, and
JSON-object request contracts automatically.

## Behavior

- Router mounts use `mountRouter`, allowing nested API routes to be inspected
  without parsing source files or relying on Express internals for mount paths.
- CI verifies both directions of drift: every live route is documented and
  every manually documented `/v1` route still exists.
- POST, PATCH, and PUT operations publish a JSON request contract. Runtime
  middleware rejects non-object mutation bodies with the standard traceable
  validation envelope.
- Quote, policy lifecycle, rating, import batch, and reinsurance treaty routes
  use stronger operation-specific schemas.
- Portal summary, policy detail, and document responses publish explicit
  customer-safe projection schemas; DB integration tests remain authoritative
  for tenant and linked-customer isolation.

## Files

- `server/src/route-registry.ts`
- `server/src/openapi.ts`
- `server/src/contracts.ts`
- `contracts/*.request.schema.json`
- `server/src/__tests__/openapi-contract.test.ts`

## Validation

- `npm run typecheck`
- `npm run build`
- `npm run test:local`
- `npm run test:integration`

## Follow-up Rule

New routers must be mounted with `mountRouter`. New mutation routes receive the
baseline contract automatically, but high-risk or externally consumed bodies
should add a named JSON Schema and an OpenAPI operation override.
