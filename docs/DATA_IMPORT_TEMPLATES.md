# Data Import Templates

This document explains the legacy data import templates under
`contracts/import-templates/`, added for issue #218 as the first concrete
slice of #67 (data migration and legacy book import framework).

Each template is a JSON file with:

- `entityType`: matches `server/src/services/data-import.service.ts`'s
  `SUPPORTED_ENTITY_TYPES` / `IMPORTABLE_ENTITY_TYPES_FRAMEWORK_ONLY` values.
- `status`: `implemented` (has a real commit handler today) or
  `framework-only` (can be staged via the import API, but validation always
  fails with an explicit "no validator/commit handler yet" error, and commit
  is rejected — see `docs/tasks/issue-67-data-migration-import-framework.md`).
- `mapsTo`: which real table(s) (`server/src/schema.ts`) each part of the
  payload is expected to land in once a commit handler exists.
- `fields`: field-by-field description with required/optional and mapping
  notes (omitted from `customer.json`, which documents an already-real API
  contract instead of proposing one — see below).
- `sampleRows`: 2-3 realistic-but-entirely-fictional rows. No sample contains
  real customer names, emails, SSNs, addresses, or identifiers.

Validate all templates parse and have the required shape with:

```bash
npm run check:import-templates
```

## `customer` — implemented

`contracts/import-templates/customer.json` documents the **real, working**
payload shape already accepted by `POST /api/v1/admin/customers/import` and
the `customer` entity type in the staging framework
(`server/src/services/data-import.service.ts`). It reuses
`NormalizedCustomerInput` (`server/src/routes/customers.routes.ts`) exactly —
nested `identity.person` / `identity.company`, `contactPoints[]`,
`addresses[]`, `relationships[]`, `externalIdentifiers[]`. This is not a
proposal; a row shaped like this template can be staged, validated, and
committed today.

## `agency`, `producer` — framework-only

Both map onto the generic party model (`parties`, `party_roles`,
`party_contacts`, `party_licenses`) rather than dedicated tables — there is
no `agencies` or `producers` table in this codebase. `producer.json` links to
its parent agency via `agencyExternalId`, resolved through
`import_external_refs` at commit time rather than a direct foreign key at
staging time (the same reconciliation-ledger pattern the customer handler
already uses for its own external identifiers).

## `policy`, `policy_term` — framework-only, the real remaining blocker

These two are why #67 is still open. `policy.json` proposes the field shape
for a legacy policy's current state (product, jurisdiction, term dates,
insured/producer links); `policy_term.json` proposes the effective-dated term
snapshot that maps to `policy_versions`.

**Neither template implies a raw `INSERT INTO policies`.** Per
`docs/tasks/issue-67-data-migration-import-framework.md`'s explicit
follow-up note, a policy has a lifecycle state machine (quote → bind → issue)
that a staged-row insert must not bypass. A future commit handler must drive
these fields through the real bind/issue transaction services
(`server/src/services/quote-bind.service.ts`) or an explicit, reviewed
legacy-issuance path — see issue #219 for the design work this needs before
implementation, and issue #67 for the implementation itself.

## `risk`, `coverage` — framework-only

Map to `risk_units` and `coverages`. `risk.json`'s `attributes` shape depends
on `kind` (`autoVehicle` mirrors `auto_vehicles`' columns, `dwelling` mirrors
`dwellings`' columns — these are the two risk kinds this codebase models
today). `coverage.json`'s `definitionCode` must match a real coverage code
for the policy's product — see `products/<product>/coverage.yaml` for the
actual codes (e.g. homeowners' dwelling coverage is code `A`, not a
descriptive string).

## `document` — framework-only

Maps to `documents`. Note that a legacy document import is really two
concerns: the metadata row (this template) and getting the actual file
content behind the storage adapter
(`server/src/services/document-storage.service.ts`) so `documents.uri`
points at something real. This template documents the metadata shape only;
the file-migration mechanism is a separate, unaddressed design question.

## `transaction_history` — framework-only

Maps to `policy_transactions`. This is explicitly an audit-trail backfill,
not a way to drive current policy state — `type` must use this codebase's
real `txn_type_enum` values (`NB`, `ENDORSE`, `CANCEL`, `REINSTATE`,
`REWRITE`, `RENEW`, `NON_RENEWAL`, all uppercase; a template or commit
handler using lowercase/mixed-case values will fail against the real
Postgres enum, a mistake documented in
`docs/tasks/issue-232-*` history in this repo).

## Adding a new entity type's template

1. Read the real table(s) in `server/src/schema.ts` the entity maps to.
2. Add `contracts/import-templates/<entity>.json` following the shape above.
3. Run `npm run check:import-templates`.
4. Update this document with a section explaining the mapping.
5. Do not add a commit handler in the same PR as a template unless the issue
   explicitly asks for both — templates and commit handlers are reviewed
   separately per `docs/tasks/issue-67-data-migration-import-framework.md`'s
   own precedent (customer's commit handler existed before these templates
   for the other seven types did).
