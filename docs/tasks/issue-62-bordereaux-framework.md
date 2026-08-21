# Task Note: Bordereaux Generation And Validation Framework

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/62
- Pull request:

## Summary

Added a bordereaux generation and validation framework: risk, premium,
transaction, cancellation, correction, and claims-reference-handoff batch
types, generated from persisted policy/risk/transaction data, with per-row
validation, CSV/JSON export, and correction/resubmission tracking. Builds on
the reinsurance treaty/facultative model from issue #61
(`docs/REINSURANCE_MODEL.md`), including treaty/ceded-premium fields on
transaction-scoped rows when a placement has been computed for that
transaction.

## Important Files

- `server/migrations/044_bordereaux_framework.sql`: `bordereaux_batches` and
  `bordereaux_rows` tables, tenant-scoped with RLS.
- `server/src/services/bordereaux.service.ts`: row builders for RISK
  (from `risk_units`) and PREMIUM/TRANSACTION/CANCELLATION/
  CLAIMS_REFERENCE_HANDOFF (from `policy_versions`), the shared
  `validateBordereauRow` rule set, `generateBordereau` (persists every row,
  valid or not), and `toCsv` export.
- `server/src/routes/bordereaux.routes.ts`: admin API — list/get/generate
  batches, list rows, export (JSON or `?format=csv`).
- `frontend/src/features/admin/BordereauxPage.tsx`: generation form + batch
  history with an expandable row-detail view.
- `server/src/lib/rbac.ts` / `frontend/src/auth/permissions.ts`: new
  `admin.bordereaux.read`/`admin.bordereaux.manage` permissions and
  `bordereaux_admin` role, mirrored on both sides per this repo's existing
  pattern.

## Behavior Rules

- Invalid rows are persisted and flagged (`is_valid = false`,
  `validation_errors`), never silently dropped — operators review and correct
  source data rather than losing rows.
- A RISK bordereau sources one row per `risk_units` record whose
  `effective_date` falls in the reporting period; all other types source one
  row per `policy_versions` record (a processed transaction) in the period.
- Reinsurance treaty/ceded-premium fields are populated from
  `policy_reinsurance_placements` when a placement has been computed for that
  transaction (via issue #61's `computePlacementForTransaction`), and are
  `null` otherwise — this framework does not compute placements itself.
- A correction/resubmission is a new batch (`correctsBatchId`) referencing
  the prior one; the prior batch's status flips to `Corrected` but its rows
  are never mutated, preserving an auditable history.
- Column set for CSV/JSON export is the union of keys present in a batch's
  row `data`, so each bordereau type gets an appropriate column set without a
  hardcoded per-type schema.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/bordereaux.service.test.ts` (unit: type
    validation, per-type row validation rules, CSV escaping/column union)
  - `server/src/__tests__/bordereaux.integration.test.ts` (DB integration:
    risk bordereau generation, transaction/premium bordereau with reinsurance
    fields populated, invalid-row flagging + correction tracking, RBAC denial)
  - `frontend/src/features/admin/__tests__/BordereauxPage.test.tsx`
    (component: batch list rendering, empty state, generation form submit,
    row-detail expand/collapse)
- Test layer used: unit + DB-backed integration + frontend component tests.
- Why this layer is enough: row validation and CSV serialization are pure
  logic covered by unit tests; generation/persistence/RBAC/tenant scoping
  need a real database, covered by integration tests; the admin UI's
  data-driven rendering is covered by component tests with mocked hooks.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration
```

All four passed locally (193 server + 86 frontend unit/component tests; 54
integration tests across 15 files including this issue's 4).

## Follow-Ups Or Risks

- Only RISK and PREMIUM/TRANSACTION generation paths are wired to real data;
  CANCELLATION reuses the same transaction-row builder filtered to
  `transaction_type = 'Cancel'`, and CLAIMS_REFERENCE_HANDOFF uses the same
  builder without a claims data source in this codebase yet — it will
  generate rows but with claims-specific fields absent until claims data
  exists.
- No excess-of-loss layer-stacking math is applied to ceded premium on a
  bordereau row when multiple treaty layers match a transaction (matches the
  same deliberate gap documented in `docs/REINSURANCE_MODEL.md`).
- No PDF export, only CSV/JSON.
- No scheduled/automatic bordereaux generation (e.g. a monthly job); this is
  on-demand via the admin API/UI, consistent with issue #61's decision not to
  auto-wire reinsurance computation into transaction services yet. A future
  batch/scheduler framework job (issue #57, if not already merged) would be a
  natural place to automate periodic generation.
