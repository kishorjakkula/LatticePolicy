# Task Note: Data Migration And Legacy Book Import Framework

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/67
- Pull request:

## Summary

Added a generic staging-based import framework (stage → validate → commit →
retry) with a fully wired commit handler for the `customer` entity type. The
customer handler reuses the existing single-record customer create/update,
validation, and external-identifier matching logic instead of duplicating it,
so a staged import is validated and committed with exactly the same rules the
admin customer API already enforces.

## Important Files

- `server/migrations/040_data_import_framework.sql`: `import_batches`,
  `import_rows`, and `import_external_refs` tables with tenant RLS.
- `server/src/services/data-import.service.ts`: stage/list/validate/commit/retry
  orchestration; the `customer` commit handler.
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
- Only `customer` has a commit handler in this slice. `agency`, `producer`,
  `policy`, `policy_term`, `risk`, `coverage`, `document`, and
  `transaction_history` can be staged (rows persist with their raw payload)
  but validation always fails with an explicit "no validator/commit handler
  yet" error, and commit is rejected until a handler is added — this keeps the
  framework honest about what it can actually import today rather than
  silently no-oping.

## Automated Tests

- Tests added: `server/src/__tests__/data-import.integration.test.ts` (DB
  integration, 2 tests): stage → validate (1 valid + 1 invalid row) → commit →
  re-import the same external identifier in a second batch and confirm it
  updates the same customer (`commitMode: 'updated'`) instead of creating a
  duplicate; and a second test covering RBAC denial for non-admin roles plus
  the framework-only entity type path (stages, fails validation, commit
  rejected with `409 BATCH_NOT_VALIDATED`).
- Test layer used: DB-backed integration tests via `npm run test:integration`
  (real Postgres 15 in a disposable Docker container).
- Why this layer is enough: the commit path's correctness depends entirely on
  real interaction with `customers`, `customer_external_identifiers`, and RLS
  — a mocked unit test would not have caught the two real bugs found while
  building this (see Follow-Ups).
- Full suite validated alongside: `npm run test` (74 frontend + 136 server,
  all passing) and `npm run typecheck` (clean).

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration
```

## Follow-Ups Or Risks

- Only `customer` import is fully wired end-to-end. `policy`/`policy_term` in
  particular need a deliberate design pass before adding a commit handler —
  policies have a lifecycle state machine (quote → bind → issue) that a
  direct staged-row insert must not bypass, unlike customers which are
  simpler master data. Do not add a "just INSERT INTO policies" handler
  without going through the real bind/issue path or an explicit, reviewed
  decision to add a legacy-import-specific policy creation path.
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
