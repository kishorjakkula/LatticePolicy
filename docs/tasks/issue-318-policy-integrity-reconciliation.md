# Issue 318: Policy Integrity Reconciliation

## Goal

Continuously identify incomplete policy records and side effects before they become customer, accounting, or regulatory failures.

## Implementation

- Migration `055_policy_integrity_reconciliation.sql` adds tenant-scoped `policy_integrity_exceptions`, its RLS policy, queue indexes, and a six-hour scheduled job.
- `policy_integrity_reconciliation` detects missing versions, ratings, forms, documents, ledger events, customer links, and failed document/outbox side effects.
- Each run carries a correlation ID, refreshes existing findings, and automatically resolves findings that no longer reproduce.
- The operations dashboard lists unresolved findings, includes them in summary counts, exports CSV evidence, and supports acknowledge, resolve, and policy-scoped retry actions.
- Retry enqueues a durable job instead of performing reconciliation inside the HTTP request.

## Safety

- Every detector and exception query is tenant-scoped; the exception table also uses PostgreSQL RLS.
- Reconciliation is observational. It does not synthesize missing insurance records or silently change policy state.
- Operator resolution is auditable. A retry reruns detection; repairs that require business decisions remain explicit through the suggested action.

## Verification

- Unit tests verify all seven detector classes and tenant/policy scoping.
- DB integration tests seed and detect every exception class.
- Operations dashboard component tests cover the queue empty state and existing dashboard behavior.
