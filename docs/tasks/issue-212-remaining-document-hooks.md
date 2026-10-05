# Task Note: Remaining Servicing Document Hooks (Issue #212)

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/212
- Pull request:

## Summary

Issue #212 asked for document generation hooks on reinstatement and
non-renewal transactions, citing `docs/tasks/policy-document-generation.md`'s
note that these were still follow-up work. Verifying against the current
codebase before writing any code showed issue #89 ("Add servicing
transaction document hooks") already closed this gap: both transaction
types call `buildPolicyDocumentPacket` / `persistPolicyDocumentPacket` in
`server/src/services/lifecycle.service.ts`, and both already have DB
integration test coverage. No new implementation or tests were needed.

## Verification Evidence

- `reinstatePolicy` (`lifecycle.service.ts:658-876`) calls
  `buildPolicyDocumentPacket` at line 722 and `persistPolicyDocumentPacket`
  at line 767, with `transactionType: 'Reinstate'`.
- `nonRenewPolicy` (`lifecycle.service.ts:1509-...`) calls
  `buildPolicyDocumentPacket` at line 1537 and `persistPolicyDocumentPacket`
  at line 1576, with `transactionType: 'NonRenewal'`.
- Both follow the identical pattern already used for `cancelPolicy`,
  `renewPolicy`, and `rewritePolicy` — same helper functions, same
  product/state/transaction-type/effective-date/tenant form selection.
- Customer-safe visibility is enforced inside the shared document
  generation service (a packet is customer-safe only if every included
  form is customer/insured/portal visible), not per-transaction-type, so
  reinstatement and non-renewal packets get the same protection as every
  other transaction type without special-casing.
- Existing integration test coverage already asserts this:
  `server/src/__tests__/policy-lifecycle.integration.test.ts` lines
  202-203 (`REINSTATE` form count and transaction documents) and lines
  369-370 (`NON_RENEWAL` form count and transaction documents).

## Important Files

- `server/src/services/lifecycle.service.ts`: no changes — verified
  existing wiring for `reinstatePolicy` and `nonRenewPolicy`.
- `server/src/__tests__/policy-lifecycle.integration.test.ts`: no
  changes — verified existing coverage for both transaction types.

## Behavior Rules

- No new behavior. This note exists so future readers of
  `docs/tasks/policy-document-generation.md`'s original "still follow-up
  work" note don't re-open this as if it were unimplemented.

## Automated Tests

- Tests added or updated: none — pre-existing coverage already satisfies
  this issue's acceptance criteria.
- Test layer used: existing DB-backed integration tests (see Verification
  Evidence above).
- Why this layer is enough: this is a verification-only change with no
  new code paths to cover.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

All pass (250 server unit tests). `npm run test:integration` could not be
run in this environment — Docker's local image/metadata store is
corrupted (`containerd` blob-store I/O errors), a pre-existing host issue
unrelated to this change, already noted in several other task notes this
session. The relevant integration assertions (cited above) already exist
in the suite and should be confirmed green in CI.

## Follow-Ups Or Risks

- None identified specific to this issue.
