# WP-0004 Phase 3: AI audit (REQ-19)

## Scope and implementation

Continuation of approved WP-0004 requirements/design/test plan (Gates A/B).
Only AI audit service, frontend API/page/styles, focused tests and this note are
owned by this slice. No workflow status, package/lock, global styles, migration,
OpenAPI, unrelated feature, commit, merge or deployment changes were made.
Existing dirty changes and concurrent parent work are preserved.

- `server/src/services/ai-audit.service.ts`: offset paging (default 0/25,
  maximum limit 500), filtered total, exact model/user filters and provenance.
  Items and total use the same SQL statement/snapshot, including empty pages.
  Sort is timestamp descending, chain sequence descending, source, event ID.
- `frontend/src/api/ai-audit.api.ts`: additive filter/response types and numeric
  query serialization (including offset zero).
- `frontend/src/features/admin/AiAuditPage.tsx`: 25-row server pagination,
  filter changes reset the page, and detail is a modal right-side panel with
  accessible name, inert background, Escape/Close, keyboard focus containment
  and focus return to the exact triggering button. Capture the trigger before
  making its background inert; browser inert behavior differs from jsdom.
- `frontend/src/features/admin/ai-audit-phase3.css`: scoped panel/mobile styles.
  `ai-audit.css`: at parent request, replace existing color literals/fallbacks
  with semantic tokens. Uses parent-owned success/warning tokens and a local
  backdrop custom property. No global styles changed by this slice.
- Existing `AiAuditPage.test.tsx` assertions updated for the additive paging API.
  New `AiAuditPage.phase3.test.tsx`, `api/__tests__/ai-audit.api.test.ts`,
  `server/src/__tests__/ai-audit-phase3.test.ts` and
  `server/src/__tests__/ai-audit-phase3.integration.test.ts` cover this slice.

## Compatibility and evidence boundaries

- Preserve `actor=all|ai|automation|person|system` as the existing kind filter.
  New `actorKind` is an alias, NOT a reassignment of `actor` to a username.
  Conflicting explicit kinds are rejected. New `user` means exact recorded
  intake actor text, or release actor UUID/current username. `model` is exact.
- `from`/`to` are inclusive offset-aware ISO timestamps; inverted ranges and
  invalid known filters return `400 INVALID_AUDIT_FILTER` (approved test plan;
  the previous ValidationError implementation returned 422).
  UI date inputs retain local start/end-of-day conversion.
- `total` applies ALL active filters. Existing `counts` remain date-scoped
  actor summary counts, independent of other filters, for compatibility.
- Intake model/provenance comes ONLY from that event's recorded
  `detail.processing`. Do not infer historical execution from the submission's
  latest processing state, actor label or a newer release. Events without
  processing metadata have null provenance.
- Release model/provenance comes from the same-tenant linked release's
  immutable artifacts plus release ID/version label. `CANDIDATE_READY` detail
  does not contain model artifacts; treating it as if it did was incorrect.
  Role/policy/export events without a release have null model/provenance.
  Raw `detail` and hash bytes remain unchanged. This is a read projection, not
  a new historical attestation of deployment or execution.
- CSV still exports at most 10,000 filtered rows from offset zero, ignoring
  caller paging limit/offset. Columns, formula protection and audited export
  remain unchanged. Export records the new filters as additional metadata.
- Tenant-scoped transactions, RLS, backend `ai.audit.read` checks, rate limits,
  append-only triggers and chain verification remain intact. Route module
  needed no changes. No new libraries are required.

## Verification

Run from repository root with Node 24.21.0 (existing installed runtime):

```sh
npm test --workspace=server -- src/__tests__/ai-audit-phase3.test.ts --maxWorkers=1
npm test --workspace=frontend -- src/features/admin/__tests__/AiAuditPage.test.tsx src/features/admin/__tests__/AiAuditPage.phase3.test.tsx src/api/__tests__/ai-audit.api.test.ts --maxWorkers=1
npm test --workspace=frontend -- src/__tests__/color-tokens.test.ts --maxWorkers=1 --testTimeout=30000
npm exec --workspace=server -- tsc --noEmit -p tsconfig.json
npm run typecheck --workspace=frontend
```

- Final one-worker reruns: server unit 4 passed; frontend component/API 11
  passed; parent color-token source guard 9 passed. The guard's previous run
  exceeded its default 5-second test timeout under concurrent load; the final
  run used the explicit 30-second timeout above with unchanged assertions.
  A transient component failure from the concurrently changed shared pager's
  undefined `matchMedia` mock result was fixed by the parent; no shared pager
  code was edited in this slice. The final focused rerun passes that fix.
- Real PostgreSQL 15, newly created disposable container
  `lattice-wp4-ai-audit-test`, database `lattice_wp4_audit_integration`,
  `LATTICE_DISPOSABLE_TEST_DATABASE=true`, `TENANT_RLS_ENFORCED=true`:
  `npm run test:integration --workspace=server -- src/__tests__/llm-releases.integration.test.ts src/__tests__/ai-audit-phase3.integration.test.ts`
  passed 23 tests in 2 files (17 existing governance + 6 new audit cases).
  New cases include 500 entries/25-row pages, filtered totals, exact identities,
  date bounds, two-tenant isolation, accurate provenance, invalid API requests,
  forbidden reads/integrity/export, full filtered CSV and append-only/hash checks.
  The new suite refuses to initialize without an explicitly disposable
  integration database. No demo/pilot database was accessed.
- Server and frontend no-emit typechecks passed on final reruns. Earlier runs
  exposed transient errors in concurrent parent-owned compliance/color-token
  test changes; those were resolved by the parent without edits from this slice.
- Browser verification uses the separate local Vite server on port 5187 and
  synthetic intercepted responses, never a live backend. Desktop and phone
  verification at 1440x1000 and 390x1000 passed: document scroll width exactly
  equals viewport width; page requests use offset 0/25 and limit 25; panel opens
  with focus, Tab stays inside, Escape closes and restores trigger focus.
  Axe reported zero violations scoped to `.ai-audit` and the detail panel at
  both widths. Screenshots inspected at `/tmp/wp4-ai-audit-{1440,390}.png` and
  `/tmp/wp4-ai-audit-detail-{1440,390}.png` (full-page screenshots). These are
  temporary verification artifacts, not committed deliverables.
- The disposable PostgreSQL container and its volume were removed after testing.
- The temporary verification Vite server was stopped. `git diff --check` passed.
- No full repository suite, production build or live-carrier workflow claimed.
  Full integration/visual suites and independent code review remain parent work.

## OpenAPI fragment for parent integration

Do not edit OpenAPI in this slice. Extend existing GET `/v1/admin/ai-audit`
and export filter definitions, preserving existing source/actor/search/from/to:

```yaml
parameters:
  - { in: query, name: offset, schema: { type: integer, minimum: 0, maximum: 9007199254740991, default: 0 } }
  - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 500, default: 25 } }
  - in: query
    name: actorKind
    description: Alias for legacy actor kind; conflicting explicit kinds are invalid.
    schema: { type: string, enum: [all, ai, automation, person, system] }
  - in: query
    name: model
    description: Exact recorded intake model or linked release artifact model.
    schema: { type: string, minLength: 1, maxLength: 240 }
  - in: query
    name: user
    description: Exact intake actor text or release actor UUID/username.
    schema: { type: string, minLength: 1, maxLength: 120 }
responseAdditions:
  total: { type: integer, minimum: 0, description: Count with every active filter applied. }
entryAdditions:
  model: { type: [string, 'null'] }
  modelProvenance: { type: [object, 'null'], additionalProperties: true }
errors:
  '400': INVALID_AUDIT_FILTER
```

Fragment uses OpenAPI 3.1 nullable types; adapt to the parent schema version.
Document export as ignoring paging parameters with a fixed 10,000-row cap, and
that `counts` retain legacy date-only semantics. No new detail endpoint is
required: authorized list entries already contain the full detail projection.

## Remaining limits

Offset paging is stable for a fixed trail but concurrent appends between page
requests can shift rows; this is not cursor/snapshot pagination. Exact counts
scan the filtered tenant trail; no migration/index work is included. Intake
historical events with no processing data are intentionally not backfilled.
Parent owns OpenAPI integration, full shared-checkout validation and review;
the earlier review is not approval of these new edits. No gates were approved
or updated here.
