# Issue 312: Policy Concurrency And Version Invariants

## Links

- Epic: https://github.com/kishorjakkula/LatticePolicy/issues/310
- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/312

## Summary

Policy servicing writes now share a tenant-scoped row lock. Clients can send an
`expectedTimelineVersion` precondition, and stale writes fail with a structured
conflict. Database indexes enforce unique transaction sequence and timeline
versions, while persisted policy versions are update-protected.

## Important Files

- `server/src/services/policy-concurrency.service.ts`: lock and stale-write check
- `server/migrations/050_policy_version_invariants.sql`: database invariants
- `server/src/services/lifecycle.service.ts`: lifecycle mutation locking
- `server/src/services/endorsement.service.ts`: endorsement mutation locking
- `server/src/persistence.ts`: atomic immutable-version persistence

## Behavior Rules

- All policy-changing lifecycle and endorsement services lock the policy row.
- A supplied `expectedTimelineVersion` must be a non-negative integer.
- A mismatched expected version returns `409 STALE_POLICY_VERSION` with expected
  and current values.
- Transaction sequence and timeline version values are unique per policy.
- Existing `policy_versions` rows cannot be updated; a correction appends a row.
- Cancellation attributes are written with the version insert, not patched later.

## Automated Tests

The policy lifecycle integration suite launches two concurrent endorsements
from timeline version zero. Exactly one commits; the other receives a stale
version conflict. The test also verifies unique counters and database-level
version immutability.

## Validation

```bash
npm run test:local
npm run test:integration
npm run typecheck
npm run build
```
