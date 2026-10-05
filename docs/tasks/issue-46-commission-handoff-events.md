# Task Note: Producer Commission Handoff Events

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/46
- Pull request:

## Summary

Added tenant-scoped producer commission handoff events for policy-changing
transactions. The events are persisted as `COMMISSION_HANDOFF` ledger rows and
therefore flow through the existing async outbox without adding commission
calculation or payment responsibilities to LatticePolicy.

## Important Files

- `server/src/services/commission-handoff.service.ts`: event contract builder,
  producer/agency extraction, and ledger insert helper.
- `server/src/services/quote-bind.service.ts`: emits the quote bind handoff.
- `server/src/services/lifecycle.service.ts`: emits issue, cancellation,
  reinstatement, rewrite, renewal, and non-renewal handoffs.
- `server/src/services/endorsement.service.ts`: emits endorsement handoffs.
- `docs/COMMISSION_HANDOFF.md`: runtime boundary and payload contract.

## Behavior Rules

- Commission events must stay tenant-scoped and use stable downstream
  idempotency keys.
- LatticePolicy emits transaction facts and premium impact only.
- External commission/accounting systems own commission calculation, payables,
  statements, chargebacks, payment status, and reconciliation.
- Existing policy lifecycle ledger events remain unchanged; commission handoffs
  are separate `COMMISSION_HANDOFF` ledger rows.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/commission-handoff.service.test.ts`
  - `server/src/__tests__/policy-lifecycle.integration.test.ts`
- Test layer used: server unit plus DB-backed lifecycle integration.
- Why this layer is enough: the unit test verifies the reusable payload
  contract, while the integration test proves persisted new-business and
  premium-adjusting transaction events through the same ledger path that feeds
  the async outbox.

## Validation

```bash
npm --workspace server test -- commission-handoff.service.test.ts
npm run test:integration
npm run typecheck
```

## Follow-Ups Or Risks

- Add API/UI observability for outbound commission handoff event status when
  operational dashboards are implemented.
- Enrich quote/policy payloads from formal producer and agency records when
  producer assignment becomes a first-class quote workflow.
