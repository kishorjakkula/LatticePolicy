# Task Note: Policy Document Generation

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/47
- Pull request:

## Summary

Added the first DB-backed policy document generation hook for quote bind/new
business. The bind flow now selects configured forms, attaches form metadata to
the NB transaction, persists `policy_forms`, and creates a generated
`POLICY_PACKET` document record with audit and visibility metadata.

## Important Files

- `server/src/services/document-generation.service.ts`: form selection,
  document packet metadata creation, and persistence helpers.
- `server/src/services/quote-bind.service.ts`: calls the document service
  during bind before writing the NB transaction and persists packet metadata
  after the transaction row exists.
- `server/src/services/__tests__/document-generation.service.test.ts`: unit
  coverage for admin/catalog form selection and customer-safe packet metadata.
- `server/src/__tests__/quote-to-bind.integration.test.ts`: DB integration
  assertions for persisted forms and policy packet documents.

## Behavior Rules

- Active approved/filed forms from `forms_admin_*` are selected by tenant,
  product, state, effective date, and transaction type.
- Active `forms_catalog` rows are also considered for product/state/transaction
  matches.
- Admin form IDs are stored in metadata because `policy_forms.form_id` points to
  `forms_catalog`.
- A generated packet is customer-safe only when every included form is
  customer/insured/portal visible; mixed packets remain internal.
- Servicing transaction hooks for endorsement, cancellation, renewal, rewrite,
  reinstatement, and non-renewal are still follow-up work.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/document-generation.service.test.ts`
  - `server/src/__tests__/quote-to-bind.integration.test.ts`
- Test layer used: server unit tests and DB integration test assertions.
- Why this layer is enough: form selection and packet metadata are pure enough
  to validate without a database, while bind persistence is verified in the
  existing DB integration path when `DATABASE_URL` is available.

## Validation

```bash
PATH="/Users/srividyajakkula/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run build
PATH="/Users/srividyajakkula/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm test
```

## Follow-Ups Or Risks

- `npm run test:integration` requires `DATABASE_URL`; this local shell did not
  have it set.
- Add servicing transaction document hooks after the bind packet path merges.
- Add a customer portal document listing endpoint that filters on
  `metadata.customerSafe = true`.
- Add real artifact rendering/storage behind the generated URI scheme.
