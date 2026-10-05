# Issue 265: Transaction Structured Errors

## Summary

Transaction routes now send failures through the shared application error
handler. Error responses consistently include `code`, `message`, and `traceId`
without changing transaction status codes, authorization, or tenant scoping.

## Issue

- GitHub issue: #265

## Files Changed

- `server/src/routes/transactions.routes.ts`
- `server/src/__tests__/quote-policy-fallback.test.ts`
- `server/src/__tests__/openapi-contract.test.ts`

## Behavior Rules

- Missing policies remain tenant-safe `404 POLICY_NOT_FOUND` responses.
- Invalid transaction modes and lifecycle states remain `400` responses.
- Schema validation remains a `422 VALIDATION_ERROR` response.
- Service errors retain their existing typed status and code.
- Unexpected failures use the global sanitized `500 INTERNAL_ERROR` response.
- Every error response includes the request's `traceId`.

## Tests

- Fallback API coverage verifies transaction validation and tenant-isolated
  not-found responses include the standard contract.
- OpenAPI drift coverage verifies all transaction operations advertise the
  shared validation and error schemas.

## Validation

```bash
npm run test --workspace=server
npm run typecheck
npm run build
npm run security:audit
```

## Follow-ups

Other route families identified by issue #215 can adopt the same typed-error
pattern in separate focused changes.
