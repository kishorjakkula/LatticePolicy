# Issue 308: Customer Portal Response Contracts

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/308

## Summary

Customer portal summary, policy detail, and document-list responses are checked
against strict runtime schemas before serialization. This creates a fail-closed
boundary against accidental exposure of internal policy, customer, document,
or payload fields.

## Important Files

- `server/src/contracts/customer-portal.contracts.ts`: strict response schemas
  and safe validation errors.
- `server/src/routes/customer-portal.routes.ts`: validates successful responses
  and logs contract failures without exposing details.
- `server/src/openapi.ts`: mirrors the runtime customer-safe projections.

## Behavior Rules

- Unknown fields are rejected at each customer-facing object boundary.
- Coverage and vehicle values may contain scalar display values only.
- Database `Date` values are normalized to ISO strings before serialization.
- Contract failures return a generic 500 response; only field paths and issue
  codes are written to server logs.
- Tenant, permission, and linked-customer checks remain unchanged and run before
  any successful response is constructed.

## Automated Tests

- Runtime contract unit tests cover accepted projections, date normalization,
  unknown-field rejection, unsafe nested values, and document projections.
- Existing DB integration tests exercise all three portal response paths.
- OpenAPI tests verify strict response definitions remain published.

## Validation

```bash
npm run typecheck
npm run build
npm run test:local
npm run test:integration
```

## Follow-Ups Or Risks

- Keep runtime and OpenAPI schemas synchronized when portal fields change.
