# Task Note: Data Migration And Legacy Book Import Framework

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/67
- Pull request:

## Summary

Added a generic staging-based import framework (stage → validate → commit →
retry) with fully wired commit handlers for the `customer` and `policy`
entity types. The customer handler reuses the existing single-record customer
create/update, validation, and external-identifier matching logic instead of
duplicating it, so a staged import is validated and committed with exactly
the same rules the admin customer API already enforces. The policy handler
(added per the design in `docs/DATA_IMPORT_DESIGN.md` / issue #219) replays
the real `createOrRateQuote` → `bindQuote` → `issuePolicy` service sequence
per row instead of writing directly to policy tables, so an imported policy
gets real state-machine validation, rating, UW evaluation, and a real
transaction/version audit trail — exactly what a policy created through the
live UI gets.

## Important Files

- `server/migrations/040_data_import_framework.sql`: `import_batches`,
  `import_rows`, and `import_external_refs` tables with tenant RLS.
- `server/src/services/data-import.service.ts`: stage/list/validate/commit/retry
  orchestration; the `customer` and `policy` commit handlers,
  `findExistingExternalRef` (the policy idempotency check).
- `server/src/routes/data-import.routes.ts`: admin API surface, mounted at
  `/api/v1/admin/import`.
- `server/src/routes/customers.routes.ts`: exported `createCustomerRecord`,
  `updateCustomerRecord`, `findExistingCustomerByExternalIdentifiers`,
  `loadCustomerRecordById`, `loadCustomerSettings`, `normalizeCustomerInput`,
  `validateCustomerPayload`, and the `QueryFn`/`NormalizedCustomerInput`/
  `CustomerValidationConfig` types (previously module-private) so the import
  service can reuse them instead of re-implementing customer business rules.
- `server/src/lib/rbac.ts`: `admin.import.read`/`admin.import.manage`
  permissions and a `data_import_admin` role.
- `frontend/src/features/admin/DataImportPage.tsx`: minimal admin UI to stage
  a batch (JSON rows), validate, commit, and retry failed rows.
- `server/src/__tests__/data-import.integration.test.ts`: DB-backed coverage.

## Behavior Rules

- A staged row's `payload` object must be the exact same shape the existing
  `/api/v1/admin/customers/import` endpoint accepts, including
  `externalIdentifiers` nested inside `payload` (not as a sibling field) —
  `normalizeCustomerInput` only reads fields from the object it is given.
- Validating a batch runs the *same* `validateCustomerPayload` check (with the
  tenant's real `CustomerValidationConfig`) that `createCustomerRecord`/
  `updateCustomerRecord` enforce at commit time, so a row marked `Valid` is
  guaranteed to actually commit (no separate, looser pre-check).
- Committing a batch only processes rows already marked `Valid`. Rows that
  fail validation are never attempted and do not move the batch to
  `PartiallyCommitted` — that status is reserved for rows that fail during the
  commit step itself (e.g. a race, a DB error).
- Idempotency for the customer entity type is delegated entirely to the
  existing `customer_external_identifiers` table and
  `findExistingCustomerByExternalIdentifiers` lookup — re-importing the same
  `sourceSystem`/`externalId` pair (in the same or a different batch) updates
  the existing customer instead of creating a duplicate.
- `import_external_refs` is a separate, generic reconciliation ledger
  (`tenant_id, entity_type, source_system, external_id` → committed entity)
  used for cross-batch audit/traceability; it is not the idempotency source of
  truth for customers, which already has its own dedicated table.
- `customer` and `policy` have commit handlers. `agency`, `producer`,
  `policy_term`, `risk`, `coverage`, `document`, and `transaction_history` can
  be staged (rows persist with their raw payload) but validation always fails
  with an explicit "no validator/commit handler yet" error, and commit is
  rejected until a handler is added — this keeps the framework honest about
  what it can actually import today rather than silently no-oping.
- Policy import does **not** write directly to `policies`/`policy_transactions`/
  `policy_versions`. A staged policy row's `payload.quote` is passed to
  `createOrRateQuote`, the resulting quote is passed to `bindQuote`, and the
  bound policy is passed to `issuePolicy` — the same three service functions a
  live user's three HTTP requests already drive. `createOrRateQuote`/
  `bindQuote` are called with a dummy `{} as any` in place of `db` because
  neither function reads that parameter (both open their own
  `withTenantTx` internally); `issuePolicy` genuinely uses `db`, so the real
  `DrizzleDB` from the route's own `withTenantTx` is threaded through to it.
  See `docs/DATA_IMPORT_DESIGN.md` for the full rationale.
- Policy import is idempotent by **skip**, not upsert: `commitPolicyRow`
  checks `import_external_refs` first via `findExistingExternalRef`, and if
  the `sourceSystem`/`externalId` pair was already committed, returns the
  existing `policyId` with `commitMode: 'skipped'` without calling
  `createOrRateQuote`/`bindQuote`/`issuePolicy` again. Re-running
  create→bind→issue on an already-issued policy would either throw (the
  state machine only allows `issue` from `Bound`) or fabricate a duplicate
  transaction/version pair — never do this.
- A staged policy row's payload shape is
  `{ payload: { externalIdentifiers: [{ sourceSystem, externalId }], quote: {...} } }`,
  where `quote` is validated with the exact same `validateQuoteDetailed`
  contract validator `createOrRateQuote` itself enforces. A UW decline
  (`quote.uw.decision === 'Decline'`) surfaces as a normal `Failed` row with
  `bindQuote`'s error message, exactly like any other commit-time failure —
  no policy-specific exception handling was added.
- This scope is limited to importing already-issued business
  (create→bind→issue in one pass, per row). Importing a policy at `Bound`
  (not yet `Issued`) or replaying prior servicing transaction history is
  explicitly out of scope — see Follow-Ups.

## Automated Tests

- Tests added: `server/src/__tests__/data-import.integration.test.ts` (DB
  integration, now 4 tests):
  1. customer stage → validate (1 valid + 1 invalid row) → commit → re-import
     the same external identifier in a second batch and confirm it updates
     the same customer (`commitMode: 'updated'`) instead of creating a
     duplicate.
  2. RBAC denial for non-admin roles, plus an unhandled-entity-type row
     failing real validation (stages, fails validation, commit rejected with
     `409 BATCH_NOT_VALIDATED`).
  3. **New**: policy stage → validate → commit replays quote→bind→issue and
     produces a real `Issued` policy (asserted via `GET /policies/:id`); a
     duplicate import of the same `sourceSystem`/`externalId` in a second
     batch is committed with `commitMode: 'skipped'` and the same `policyId`,
     not a second policy.
  4. **New**: a contract-valid policy quote with `uwAnswers.driverAge: 15`
     (a hard UW decline for personal-auto) is marked `Valid` at validation
     but fails at commit with `bindQuote`'s `UW_DECLINED` message, leaving
     the batch `PartiallyCommitted` and the row `Failed` — confirming a real
     business-rule rejection surfaces exactly like any other commit failure.
- Test layer used: DB-backed integration tests via `npm run test:integration`
  (real Postgres 15 in a disposable Docker container).
- Why this layer is enough: the commit path's correctness depends entirely on
  real interaction with `customers`/`customer_external_identifiers` or the
  real quote/bind/issue service chain and RLS — a mocked unit test would not
  have caught the real bugs found while building the customer handler (see
  Follow-Ups), and would not exercise the policy handler's actual state
  machine, rating, and UW evaluation at all.
- Full suite validated alongside: `npm run build`, `npm run test` (101
  frontend + 250 server, all passing), `npm run typecheck` (clean).
- `npm run test:integration` could not be executed in this environment: the
  local Docker daemon's image store is corrupted (`docker pull postgres:15`
  fails with a containerd `input/output error` on its own metadata db,
  unrelated to this change and not something `docker rmi`/`docker pull`
  could repair). The new tests were reviewed carefully against the exact
  behavior of `createOrRateQuote`/`bindQuote`/`issuePolicy`,
  `validateQuoteDetailed`, and `evaluateUW` (all read directly, not assumed)
  and mirror the DB-query and assertion style of the customer tests and of
  `reinsurance-lifecycle-wiring.integration.test.ts` (which already
  establishes the `{} as any` dummy-`db` pattern for `createOrRateQuote`/
  `bindQuote` in this codebase), but they have not been run end-to-end
  against a real database as part of this change. A maintainer with a
  working Docker environment should run `npm run test:integration` before
  merging.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration   # not run in this environment — see Automated Tests
```

## Follow-Ups Or Risks

- **Not run in this environment**: `npm run test:integration` (Docker image
  store corruption, unrelated to this change — see Automated Tests). Run it
  before merging.
- **Transaction-scope caveat for policy commits**: `commitImportBatch` runs
  inside one outer `withTenantTx` (opened by the route handler), and updates
  the corresponding `import_rows`/`import_batches` rows via that same
  transaction's `q`. But `commitPolicyRow`'s `createOrRateQuote`/`bindQuote`/
  `issuePolicy` calls each open and commit their **own** independent
  `withTenantTx` internally, so a successfully issued policy is durably
  committed to the database *before* the outer transaction records the
  `import_external_refs` entry and marks the row `Committed`. In the narrow
  window where the outer transaction subsequently fails for an unrelated
  reason (e.g. a lost DB connection) after a policy was already issued, the
  policy would exist without a recorded external ref, and a retry would not
  find it via `findExistingExternalRef` — risking a second create→bind→issue
  run for the same legacy record. This mirrors a real limit of composing
  transaction-owning service functions, not a bug introduced by carelessness;
  it is called out explicitly rather than fixed here because a real fix
  (making `createOrRateQuote`/`bindQuote`/`issuePolicy` accept an existing
  transaction) is a materially larger, higher-risk refactor of core lifecycle
  services that touches every other caller of those three functions, not
  just data import.
- `agency`/`producer` entity types should follow the customer pattern
  directly (simple master data, no lifecycle). `transaction_history` needs
  its own design pass (replaying arbitrary prior servicing transactions
  against an already-imported policy). A `targetStatus: 'Bound' | 'Issued'`
  option on staged policy rows would support importing in-flight business,
  if a real carrier migration needs it — see `docs/DATA_IMPORT_DESIGN.md`.
- No bulk file upload (CSV/Excel) parsing is included; batches are staged via
  a JSON array of rows through the API/UI. A follow-up could add a parser
  ahead of `stageImportBatch`.
- No batch-size-aware background processing: `stageImportBatch` caps at 5000
  rows and `commitImportBatch` processes synchronously within the request. A
  very large batch should move to the job queue framework once issue #57
  lands, rather than growing this synchronous path.
- While building this, found and fixed two bugs of my own before they shipped:
  (1) the batch-level pre-validation didn't match the real
  `validateCustomerPayload` rules enforced at commit time, so a row marked
  `Valid` could still fail to commit; (2) `externalIdentifiers` needs to live
  inside the `payload` object, not as a sibling field, because
  `normalizeCustomerInput` only reads fields from the object it's given.
  Both are now covered by the integration test and documented above so a
  future contributor adding another entity type doesn't repeat them.
