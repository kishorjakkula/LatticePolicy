# Issue 311: Canonical Policy Lifecycle State Machine

## Links

- Epic: https://github.com/kishorjakkula/LatticePolicy/issues/310
- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/311

## Summary

Policy-changing workflows now use one explicit state machine and one persisted
status vocabulary. Invalid transitions return structured context, and repeatable
terminal operations avoid duplicate lifecycle side effects.

## Important Files

- `server/src/lib/transaction-state.ts`: canonical states and transition table
- `server/src/services/lifecycle.service.ts`: lifecycle enforcement and idempotent issue
- `server/src/routes/transactions.routes.ts`: transaction-number reservation enforcement
- `packages/types/src/index.ts`: shared persisted policy status type

## Behavior Rules

- Only `Quote`, `Draft`, `Bound`, `Issued`, `Cancelled`, and `Expired` are persisted.
- `Active` is a derived business concept, not a database status.
- Endorsement, renewal, and non-renewal require an issued policy.
- Cancellation is allowed for bound or issued policies.
- Reinstate and rewrite require a cancelled policy.
- Repeated bind, issue, and expire requests are idempotent in their target states.
- Invalid requests include the action, current state, allowed source states, and
  target state in the API error details.

## Automated Tests

- Unit coverage verifies every valid and invalid state/action combination.
- Route coverage verifies transaction-number reservation applies the same rules.
- Database integration coverage verifies repeated issuance creates no duplicate
  issuance notification intent.

## Validation

```bash
npm run test:local
npm run test:integration
npm run typecheck
npm run build
```

## Follow-Ups Or Risks

- Issue #312 adds concurrency controls around the validated transitions so two
  otherwise valid requests cannot commit against the same policy version.
