# Task Note: Pilot Foundation State And Idempotency

## Links

- Issues: https://github.com/kishorjakkula/LatticePolicy/issues/51, https://github.com/kishorjakkula/LatticePolicy/issues/54, https://github.com/kishorjakkula/LatticePolicy/issues/55
- Pull request:

## Summary

Added a first carrier-readiness implementation slice for policy transaction
guardrails, idempotent write handling, and API traceability.

## Important Files

- `server/src/lib/transaction-state.ts`: shared policy transaction state
  validation for issue, endorsement, cancellation, reinstatement, rewrite,
  renewal, and non-renewal flows.
- `server/src/lib/idempotency.ts`: `Idempotency-Key` middleware for write
  routes, with tenant-scoped replay and conflict handling.
- `server/migrations/033_idempotency_keys.sql`: durable database table and RLS
  policy for idempotency records.
- `server/src/app.ts`: wires idempotency into `/api/v1` after tenant validation
  and includes trace ids on application errors.

## Behavior Rules

- Idempotency applies only to `POST`, `PUT`, `PATCH`, and `DELETE` requests
  that include an `Idempotency-Key` header.
- The same tenant and idempotency key replay the original successful response
  when the method, path, and body match.
- Reusing the same tenant and key with a different request returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- Policy transaction status checks should go through
  `validatePolicyTransactionState` instead of route-local string comparisons.

## Automated Tests

- Tests added or updated:
  - `server/src/lib/__tests__/transaction-state.test.ts`
  - `server/src/__tests__/quote-policy-fallback.test.ts`
- Test layer used: server unit and fallback API integration tests.
- Why this layer is enough: the state machine is pure domain logic, and the
  fallback API suite exercises Express middleware behavior without requiring a
  database.

## Validation

```bash
PATH="/Users/srividyajakkula/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run build
PATH="/Users/srividyajakkula/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm test
```

## Follow-Ups Or Risks

- Idempotency replay is currently response-level protection. A future hardening
  task should add a transactional reservation step for concurrent duplicate
  requests in multi-node deployments.
- OpenAPI response schemas should be updated to explicitly document `traceId`
  and `IDEMPOTENCY_KEY_CONFLICT`.
