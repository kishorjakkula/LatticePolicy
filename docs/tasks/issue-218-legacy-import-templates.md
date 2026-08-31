# Task Note: Legacy Import Template Files

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/218
- Pull request:

## Summary

Added JSON template files for all 8 entity types the data migration
framework (#67) knows about — `customer` (has a real commit handler) plus
`agency`, `producer`, `policy`, `policy_term`, `risk`, `coverage`,
`document`, `transaction_history` (framework-only: can be staged, no
commit handler yet). Each template documents field mappings to the real
`server/src/schema.ts` tables and includes 2-3 fictional sample rows, per
issue #218's acceptance criteria.

## Important Files

- `contracts/import-templates/*.json` (9 files, one per entity type).
- `docs/DATA_IMPORT_TEMPLATES.md`: explains each template, its mapping
  target, and — for `policy`/`policy_term` specifically — reiterates the
  lifecycle-state-machine constraint from
  `docs/tasks/issue-67-data-migration-import-framework.md` so a future
  commit handler implementer doesn't miss it.
- `scripts/check-import-templates.mjs` / `npm run check:import-templates`:
  validates every template parses as JSON and declares `entityType`,
  `status`, and a non-empty `sampleRows` array.
- `README.md`, `docs/CARRIER_ONBOARDING_KIT.md`: cross-linked.

## Behavior Rules

- `customer.json` documents an already-real API contract
  (`NormalizedCustomerInput`) — it is not a proposal, unlike the other 8
  files, which are `"status": "framework-only"` and explicitly say so.
- `policy.json` and `policy_term.json` do not imply a raw table insert.
  They document the field shape a future commit handler needs, which must
  drive the real bind/issue transaction services or an explicit reviewed
  legacy-issuance path — never bypass the policy lifecycle state machine.
  See #219 for the design work this needs before implementation.
- `transaction_history.json`'s sample `type` values use the real
  `txn_type_enum` casing (`NB`, uppercase) — a codebase-wide gotcha
  documented after CI caught the same mistake in unrelated PRs (raw SQL
  using `'Cancel'`/`'Renew'` instead of `'CANCEL'`/`'RENEW'` against this
  enum fails at the database level even though the TypeScript layer only
  declares the column as `text()`).

## Automated Tests

- Tests added: `scripts/check-import-templates.mjs`, wired as
  `npm run check:import-templates`.
- Test layer used: a small script validating fixture structure, following
  the existing `scripts/check-npm-audit.mjs` pattern for non-Vitest
  repository-hygiene checks.
- Why this layer is enough: these are static fixture/documentation files
  with no runtime code path; the only thing worth automatically verifying
  is that they stay valid, parseable, and minimally well-formed as the
  repository evolves.

## Validation

```bash
npm run build
npm run typecheck
npm run check:import-templates
```

Documentation and fixture files only — no product behavior changed, so
`npm run test` / `npm run test:integration` are not expected to be affected
and were not the focus of this change (build/typecheck still confirm
nothing broke).

## Follow-Ups Or Risks

- No commit handler was added for any of the 8 framework-only entity
  types — that is deliberately out of scope for this issue. #67 (and #219
  for `policy`/`policy_term` specifically) track that work.
- `document.json` notes that a real document import also needs a
  file-migration mechanism behind the storage adapter
  (`server/src/services/document-storage.service.ts`), which is unaddressed
  and not part of this issue's scope.
- If a future contributor adds a ninth entity type, update
  `docs/DATA_IMPORT_TEMPLATES.md`'s "Adding a new entity type's template"
  section's guidance, not just the JSON file itself.
