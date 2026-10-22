# WP-0004 Phase 3: Compliance and Security (REQ-10)

## Context and Scope

Continues approved WP-0004 requirements/design/test plan (01-04) in the shared
checkout. Preserves the existing dirty Phase 2 reason/confirmation dialogs.
No commits, migrations, dependency changes, workflow-status edits, portal changes,
or demo/pilot database writes were made by this slice.

## Files

- `server/src/routes/compliance-admin.routes.ts`: additive bulk eligibility route.
- `server/src/__tests__/compliance-bulk.integration.test.ts`: real PostgreSQL tests.
- `frontend/src/features/admin/CompliancePage.tsx`: product columns/state rows,
  filters, bounded selection and required-reason batch dialog.
- `frontend/src/features/admin/SecurityPage.tsx`: searchable role/permission matrix,
  area grouping, sentence-case labels and system-role/read-only controls.
- `frontend/src/features/admin/compliance-security.css`: scoped layout only; no
  color literals, fallback colors or global styles.
- Corresponding `CompliancePage.test.tsx` and new `SecurityPage.test.tsx`.

## Behavior and Review Findings Addressed

- `POST /api/v1/admin/compliance/eligibility/bulk` accepts exactly `ids`, `status`,
  and `reason`. IDs are 1-500 unique UUIDs (case-normalized before duplicate
  detection); statuses remain `ACTIVE`, `SUSPENDED`, `CLOSED`, `FILING_PENDING`.
  The illustrative design's `Inactive` is not a stored eligibility status.
  Reason is trimmed, required and bounded to 2000 characters.
- Existing outer read/admin guards and `admin.compliance.manage` remain mandatory.
  All selected rows must belong to the current tenant; missing/foreign IDs return
  identical 404 errors before writes. No partial success.
- One tenant transaction locks rows in ascending UUID order (`FOR UPDATE`), updates
  only status, and inserts one existing `ledger_events` record per selected row.
  Events contain authenticated actor UUID, server-assigned `actorType: user`, time,
  reason, full before/after snapshots and status transition. Even an audit failure
  rolls back every row and prior audit insert. No AI governance logs are reused.
- Lock waits are bounded to five seconds. Lock timeout, deadlock or serialization
  conflict maps to 409 `CONCURRENT_CHANGE`; callers can refresh/retry.
- Grid filter changes clear selections. Select-all never truncates batches over
  500; individual selections stop at 500. Missing configurations remain explicitly
  unconfigured, not implicitly active. Existing-row status edits use the audited
  batch path; the create form rejects already-loaded product/state pairs.
- Batch failures remain in the reason dialog, preserving input; pending batches
  cannot be duplicated or dismissed with Escape. Read-only users have no grid
  mutation controls. Phase 2 OFAC behavior is retained.
- Security edits remain staged for the selected custom role and saved through the
  existing guarded endpoints. System roles and readers are read-only in the UI.
  Matrix search includes label, description, permission code and area. Fixed the
  existing New Role effect that immediately reselected an existing role.

## Verified Checks

Used the documented shared Node 22 runtime:
`/Users/srividyajakkula/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin` first on PATH.

- `npm run test:integration --workspace=server -- src/__tests__/compliance-bulk.integration.test.ts src/__tests__/compliance-admin.integration.test.ts`:
  **29 passed**, two files. Fresh PostgreSQL 15 database in a dedicated disposable
  container, with `LATTICE_DISPOSABLE_TEST_DATABASE=true`,
  `TENANT_RLS_ENFORCED=true`, and `LOG_LEVEL=silent`. The new suite refuses an
  unmarked database. Covers validation/bounds, exact per-row actor/snapshots,
  permissions, foreign/missing-ID rollback, audit-insert failure rollback,
  concurrent actual PATCH serialization preserving notes, and bounded 409 rollback.
- `npm run test --workspace=frontend -- src/features/admin/__tests__/CompliancePage.test.tsx src/features/admin/__tests__/SecurityPage.test.tsx src/components/__tests__/Dialog.test.tsx`:
  **24 passed**, three files. Covers grid filters/selection, reason validation,
  failure retention, pending/double-submit/Escape, read-only controls, creation
  bypass prevention, matrix search/edit/save, system roles and New Role behavior.
- `npm run test --workspace=server -- src/__tests__/openapi-contract.test.ts`:
  **12 passed**. Generated inventory includes the route, but its detailed contract
  still requires the parent-owned integration below.
- `npm run typecheck --workspace=frontend`: passed.
- `node node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json`: passed.
- Scoped `git diff --check`: passed.
- Additional shared source-guard run:
  `npm run test --workspace=frontend -- src/__tests__/color-tokens.test.ts src/__tests__/native-dialogs.test.ts src/__tests__/radio-standard.test.ts`:
  native-dialog/radio guards **4 passed**; new parent-owned color-token guard
  **9 failed before source scanning**, because `ts.ScriptTarget.Latest` reads
  `ScriptTarget` from undefined in `frontend/src/test/colorTokens.ts:16`.
  No changes were made to that out-of-scope helper. Direct scoped source scan
  found no hex/rgb/hsl color literals in either screen or the scoped stylesheet.

The disposable PostgreSQL container was removed after the final test run.

An intermediate rerun against the reused disposable database exposed fixture
reuse (global usernames and the existing OFAC suite's global SDN matches). New
usernames now have unique suffixes; the final combined run above used a fresh
database and passed. No existing OFAC test was weakened.

## Parent Integration / Pending Work

- OpenAPI is intentionally untouched because it already contains parent/UW edits.
  Add the following operation override to `server/src/openapi.ts`, using the
  existing `jsonResponse` helper. The route is already in the generated inventory.

```ts
'POST /v1/admin/compliance/eligibility/bulk': {
  summary: 'Atomically change eligibility status with a per-row audit',
  description: 'Requires admin.compliance.read and admin.compliance.manage. All IDs must belong to the request tenant. No partial success; lock contention returns 409.',
  requestBody: {
    required: true,
    content: { 'application/json': { schema: {
      type: 'object', additionalProperties: false,
      required: ['ids', 'status', 'reason'],
      properties: {
        ids: { type: 'array', minItems: 1, maxItems: 500, uniqueItems: true,
          items: { type: 'string', format: 'uuid' },
          description: 'Case-insensitive UUID duplicates are rejected.' },
        status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'CLOSED', 'FILING_PENDING'] },
        reason: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S',
          description: 'Trimmed; must contain non-whitespace characters.' }
      }
    } } }
  },
  responses: {
    '200': jsonResponse({ type: 'object', required: ['updated', 'items'], properties: {
      updated: { type: 'integer', minimum: 1, maximum: 500 },
      items: { type: 'array', minItems: 1, maxItems: 500, items: {
        type: 'object', required: ['eligibility_id', 'tenant_id', 'product_code', 'state_code', 'status'],
        properties: {
          eligibility_id: { type: 'string', format: 'uuid' },
          tenant_id: { type: 'string' }, product_code: { type: 'string' },
          state_code: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'CLOSED', 'FILING_PENDING'] }
        }, additionalProperties: true
      } }
    } }),
    '400': jsonResponse('ErrorResponse', 'INVALID_INPUT'),
    '401': jsonResponse('ErrorResponse', 'Authentication required'),
    '403': jsonResponse('ErrorResponse', 'FORBIDDEN'),
    '404': jsonResponse('ErrorResponse', 'NOT_FOUND: missing or foreign eligibility ID; no changes'),
    '409': jsonResponse('ErrorResponse', 'CONCURRENT_CHANGE: refresh and retry')
  }
},
```

- Parent owns independent review, full build/regression runs and browser/mobile/
  accessibility verification. These were not claimed as completed here.
- Parent must fix the color-token guard's TypeScript parser loading and rerun it.
- Legacy single-record POST upsert/PATCH contracts were intentionally preserved;
  this slice does not claim to retrofit their existing unaudited behavior.
- The existing eligibility list API has no pagination contract. Grid filtering is
  client-side over returned records; server product-pagination is not added here.
