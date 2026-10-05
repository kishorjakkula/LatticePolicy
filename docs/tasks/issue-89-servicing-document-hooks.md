# Task Note: Servicing Transaction Document Hooks

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/89
- Pull request:

## Summary

Wired the existing policy document generation service into the servicing
transaction lifecycle. Cancellation, reinstatement, renewal, rewrite, and
non-renewal now select applicable forms and generate/persist a policy packet
document the same way bind/new-business already does. Endorsement is left as
an explicit, documented no-op because form applicability is not yet
coverage-diff aware.

## Important Files

- `server/src/services/lifecycle.service.ts`: `cancelPolicy`, `reinstatePolicy`,
  `renewPolicy`, `rewritePolicy`, and `nonRenewPolicy` now call
  `buildPolicyDocumentPacket` before `insertPolicyTransaction` (so the
  transaction row carries `forms`/`documents` JSON) and
  `persistPolicyDocumentPacket` after (so `policy_forms` and `documents` rows
  exist for the transaction).
- `server/src/services/endorsement.service.ts`: `executeEndorsement` keeps
  `forms: []` / `documents: []` with an explanatory comment on why endorsement
  form generation is deferred.
- `server/src/services/document-generation.service.ts`: unchanged. Its
  `PolicyDocumentTransactionType` union already included `Cancel`,
  `Reinstate`, `Rewrite`, `Renew`, and `NonRenewal`, and `selectPolicyForms`
  is already transaction-type/product/state/effective-date driven, so no
  changes were needed there to support servicing transactions.
- `server/src/services/__tests__/document-generation.service.test.ts`: unit
  coverage for servicing transaction-type form selection (Cancel,
  NonRenewal) and a case with no matching forms.
- `server/src/__tests__/policy-lifecycle.integration.test.ts`: seeds a form
  applicable to Cancel/NonRenewal/Reinstate/Renew/Rewrite and asserts
  `policy_forms` rows and `POLICY_PACKET` documents exist for the Cancel,
  Reinstate, Renew, and NonRenewal transactions.

## Behavior Rules

- Servicing transactions reuse the same form-selection rules as bind: active
  forms from `forms_admin_*` or `forms_catalog` matching tenant, product,
  state, effective date, and the specific transaction type.
- A generated packet is customer-safe only when every included form is
  customer/insured/portal visible, matching the bind behavior.
- Documents/forms attached to a transaction are visible wherever the policy
  timeline already surfaces per-transaction `forms`/`documents` (see
  `policy.service.ts`, which reads `policy_forms`/`documents` joined by
  `transaction_id`); no separate wiring was needed for the timeline itself.
- Endorsement form generation is an intentional no-op today: endorsements
  change specific coverages, and form applicability in
  `forms_admin_applicability` / `forms_catalog` is not coverage-diff aware, so
  a generic packet would over-attach forms regardless of which coverage
  changed. See the comment above `insertPolicyTransaction` in
  `executeEndorsement`.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/document-generation.service.test.ts`
  - `server/src/__tests__/policy-lifecycle.integration.test.ts`
- Test layer used: server unit tests (pure form-selection logic) plus DB
  integration tests (real Postgres, via `npm run test:integration`).
- Why this layer is enough: form selection is pure and covered at the unit
  layer; persistence into `policy_forms`/`documents` and the transaction row
  is verified end-to-end against a real database for four servicing
  transaction types (Cancel, Reinstate, Renew, NonRenewal), which exceeds the
  "at least two" acceptance criterion.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration
```

All four commands pass locally (Node 20.20.2; `test:integration` runs against
the disposable dockerized Postgres via `scripts/test-integration.sh`).

## Follow-Ups Or Risks

- Endorsement document hooks are still open: add coverage-diff-aware form
  applicability (e.g. form rules keyed to which coverage/limit/deductible
  changed) before wiring `buildPolicyDocumentPacket` into
  `executeEndorsement`.
- This uses the same metadata-only `generated://` document URI scheme as
  bind; real artifact rendering/storage is tracked separately (issue #88).
- Customer portal document retrieval/listing for these servicing documents is
  tracked separately (issue #86).
