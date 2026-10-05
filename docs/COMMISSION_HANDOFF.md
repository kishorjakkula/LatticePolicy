# Producer Commission Handoff Events

LatticePolicy emits producer commission handoff events so a downstream
commission or accounting system can calculate producer compensation without
making LatticePolicy own commission accounting.

## Runtime Boundary

LatticePolicy owns:

- policy transaction source events;
- tenant, policy, transaction, product, state, and producer/agency identifiers;
- premium impact produced by the policy transaction;
- stable idempotency keys and correlation IDs;
- durable event persistence through `ledger_events` and delivery through the
  existing async outbox path.

The external commission/accounting application owns:

- commission rules and rate calculation;
- producer payable creation;
- commission statements;
- chargeback accounting;
- payment, settlement, and reconciliation status.

Policy transaction services must not calculate commission payable amounts or
store commission settlement status.

## Delivery Path

Each handoff is written as a `COMMISSION_HANDOFF` row in `ledger_events`. The
existing `async_message_outbox` trigger creates a tenant-scoped outbound
message with a `ledger.commission_handoff` topic.

The handoff event is separate from regular policy lifecycle ledger events such
as `STATUS_CHANGE`, `CANCELLED`, `ENDORSE_ISSUED`, and `RENEWED`. This keeps
existing policy behavior stable while giving downstream systems a consistent
contract.

## Event Coverage

Current transaction hooks:

- Quote bind: `QuoteBind`.
- Policy issue: `Issue`.
- Endorsement issue: `Endorse`.
- Cancellation: `Cancel`.
- Reinstatement: `Reinstate`.
- Rewrite: `Rewrite`.
- Renewal: `Renew`.
- Non-renewal: `NonRenewal`.

Non-renewal emits a zero-dollar premium impact because it is a downstream
eligibility/retention signal, not a premium-bearing transaction by itself.

## Payload Contract

Payloads use `schemaVersion = "commission-handoff.v1"`.

Top-level fields:

- `eventType`: always `COMMISSION_HANDOFF`.
- `sourceEvent`: policy lifecycle source event, such as `QUOTE_BOUND` or
  `POLICY_CANCELLED`.
- `idempotencyKey`: stable tenant/policy/transaction/type key for downstream
  de-duplication.
- `correlationId`: transaction number, request ID, or transaction ID.
- `requestId`: optional inbound request ID when available.
- `tenantId`.
- `policy`.
- `transaction`.
- `producer`.
- `premiumImpact`.
- `accountingBoundary`.

Policy fields:

- `policyId`.
- `policyNumber`.
- `productCode`.
- `state`.
- `effectiveDate`.
- `expirationDate`.

Transaction fields:

- `transactionId`.
- `transactionNumber`.
- `transactionType`.
- `effectiveDate`.
- `processedAt`.

Producer fields are best-effort from policy payload and metadata:

- `producerId`.
- `producerKey`.
- `producerNpn`.
- `producerName`.
- `agencyId`.
- `agencyKey`.
- `agencyCode`.
- `agencyName`.

Premium impact:

- `amount`.
- `currency`.

## Producer Identifier Sources

The mapper accepts common producer and agency shapes in quote/policy payloads,
including `producer`, `agent`, `broker`, and `agency` objects, plus flat fields
such as `producerId`, `producerKey`, `agencyId`, and `agencyCode`.

Future integrations with the formal `agencies`, `producers`, and
`agency_producer_affiliations` tables can enrich payloads before policy
transactions are created. The handoff contract does not require a schema
migration for the first slice.

## Idempotency

Downstream consumers should de-duplicate by `idempotencyKey`. The key is
composed from:

```text
tenantId:policyId:transactionId-or-transactionNumber:transactionType
```

If a transaction ID is available, it is preferred because it is immutable and
globally stable. Transaction number is the fallback.

## Local Development

With `ASYNC_PUSH_ENABLED=true` and no `ASYNC_PUSH_WEBHOOK_URL`, the async
worker logs outbound envelopes to stdout and marks them sent. With a webhook URL
configured, the worker posts the `ledger.commission_handoff` envelope and
applies the existing retry/backoff behavior.
