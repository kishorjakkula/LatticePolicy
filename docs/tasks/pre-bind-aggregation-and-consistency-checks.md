# Pre-Bind Aggregation And Consistency Checks

## Summary

Added two optional pre-bind underwriting checks that feed the existing
referral workflow: configurable product/state aggregation appetite limits and
an internal-record consistency check for a claimed continuous-insurance period
that conflicts with a recent non-payment cancellation.

## Behavior

- Aggregation limits are opt-in per tenant, product, and state. With no active
  limit row, bind behavior is unchanged.
- A projected TIV or policy-count breach creates an underwriting referral.
- Database failures while loading configured limits propagate; they are never
  interpreted as an unconfigured control.
- The consistency check uses only tenant-scoped LatticePolicy records for the
  matched customer. It does not represent an external loss-history service.
- The external-verification provider is deliberately inert until a real vendor
  implementation is configured.

## Important Files

- `server/migrations/056_aggregation_appetite_limits.sql`
- `server/src/services/quote-bind.service.ts`
- `server/src/services/external-verification.service.ts`
- `server/src/__tests__/quote-bind-aggregation.integration.test.ts`
- `server/src/__tests__/quote-bind-internal-consistency.integration.test.ts`

## Validation

- Server unit tests
- DB integration tests for referral creation, approval, and completed bind
- TypeScript typecheck and production build
- CI, Playwright, dependency, CodeQL, and container checks

## Follow-Up Risk

The aggregation check is advisory/referral enforcement, not a transactional
capacity reservation. Concurrent binds near a threshold can observe the same
book snapshot. A future hard-cap workflow should serialize or reserve capacity
through the final policy write.

