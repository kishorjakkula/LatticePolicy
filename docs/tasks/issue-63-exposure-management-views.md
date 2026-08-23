# Task Note: Exposure Management And Aggregation Views

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/63
- Pull request:

## Summary

Added the first exposure management slice: a query-time normalization layer
that extracts common exposure dimensions (product, jurisdiction, ZIP,
class/industry, vehicle/fleet count, cyber revenue/records, TIV) from each
tenant's in-force policy book, plus an admin summary API, CSV export, and a
minimal internal UI for carrier/reinsurer review.

## Important Files

- `server/src/services/exposure.service.ts`: `extractExposureDimensions`
  (pure, per-product normalization from a policy version's risk/coverage
  payload), `loadExposureRows`/`computeExposureSummary` (tenant-scoped
  aggregation with `asOf` support), `exposureRowsToCsv`,
  `loadTreatyProgramLabels` (bulk join against `policy_reinsurance_placements`
  for the treaty/program dimension, added once #61 merged).
- `server/src/routes/exposure.routes.ts`: `GET /summary` and
  `GET /export.csv`, mounted at `/api/v1/admin/exposure`.
- `server/src/routes/admin.routes.ts`: mounts the exposure router behind
  `admin.exposure.read`.
- `server/src/lib/rbac.ts`: new `menu.admin.exposure.view`,
  `page.admin.exposure.view`, `admin.exposure.read` permissions and a new
  `exposure_admin` role.
- `frontend/src/features/admin/ExposurePage.tsx`: filterable summary view
  (product/state/asOf) with by-product, by-state, by-class/industry, and
  by-treaty/program tables.
- `frontend/src/api/admin.api.ts`, `hooks/admin.hooks.ts`, `queryKeys.ts`,
  `App.tsx`, `AdminShell.tsx`, `auth/permissions.ts`: standard admin page
  wiring, following the pattern used by the compliance/dashboard/import
  admin pages.

## Behavior Rules

- Exposure aggregates only `status = 'Issued'` (in-force) policies; quotes,
  bound-not-issued, and cancelled policies are excluded.
- Tenant scoping is enforced in the query itself (`tenant_id = $1` plus the
  route's `req.tenant!.tenantId`), not only via RBAC.
- When `asOf` is omitted or equals today, exposure reads each policy's
  latest `policy_versions.payload` directly. When `asOf` is a past date, it
  calls the existing `getPolicyState(asOf)` (from the out-of-sequence
  timeline work in #52) per policy so historical exposure respects
  endorsements/cancellations/reinstatements that were applied out of
  sequence.
- This is a query-time normalization layer, not a materialized table —
  there is no separate sync-correctness problem, but historical (`asOf` in
  the past) queries cost one `getPolicyState` call per matching policy. See
  Follow-Ups for the scaling note.
- ZIP extraction is exact for `autoVehicle`/`commercialAutoFleet`
  (`garagingZip` field) and best-effort for `dwelling` (regex over the free
  text `address` field, since the product schema has no structured ZIP for
  homeowners today).
- TIV is the sum of `selected: true` coverage `limit` values on the policy's
  risk payload; unselected coverages are excluded.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/exposure.service.test.ts` (8 unit tests:
    per-product dimension extraction for personal-auto, commercial-auto,
    homeowners, cyber, professional-liability; unselected-coverage TIV
    exclusion; empty-payload safety; CSV output shape).
  - `server/src/__tests__/exposure.integration.test.ts` (2 DB integration
    tests: aggregation by product/state excluding non-issued and
    cross-tenant policies; API-level `productCode` filter plus
    `admin.exposure.read` RBAC enforcement — admin allowed, agent denied.
    Updated for the treaty/program dimension: `exposure.service.test.ts`'s
    CSV test now covers the `treatyProgram` column; a new
    `exposure.integration.test.ts` case seeds a treaty-placed policy, a
    facultative-placed policy, an unplaced policy, and a placement on
    another tenant's policy, asserting each labels correctly and that the
    other tenant's treaty never leaks into this tenant's aggregation.
- Test layer used: unit tests for the pure extraction/CSV logic, DB-backed
  integration tests for tenant isolation, status filtering, RBAC, and now
  treaty/facultative/unplaced labeling.
- Why this layer is enough: extraction/aggregation math is pure and cheap to
  verify without a database; tenant isolation, status filtering, and the
  treaty/program join need a real Postgres row set to prove the SQL clauses
  are correct.

## Validation

```bash
npm run build
npm run test        # 97 frontend + 244 server passing
npm run typecheck
```

`npm run test:integration` could not be run for the treaty/program dimension
addition: this environment's local Docker Desktop storage is corrupted
(`containerd` blob-store/metadata I/O errors — the same pre-existing,
unrelated issue documented in PR #197's task note), so `docker pull` and
`docker compose` both fail before a container can start. The original slice's
`test:integration` run (14 files / 47 tests) is documented above and remains
valid for the unaffected code paths; the new treaty/program integration test
is written and should be run in CI or a clean environment before merge to
confirm it passes for real, since it has not been executed against a live
database in this environment.

## Treaty/Program Dimension (Added)

Issue #61 (reinsurance treaty/facultative model) has since merged, so the
previously-deferred treaty/program dimension is now implemented:

- `loadTreatyProgramLabels` in `server/src/services/exposure.service.ts`
  bulk-loads each policy's latest `policy_reinsurance_placements` row (one
  query for the whole batch, `DISTINCT ON (policy_id) ... ORDER BY
  computed_at DESC`, not N+1) and joins `reinsurance_treaties` /
  `reinsurance_programs` / `reinsurance_facultative_certificates` to build a
  human-readable label.
- Facultative placements label as `Facultative: <certificate_number>`; treaty
  placements label as `<treaty_name> (<program_name>)` (or just
  `<treaty_name>` if the treaty has no parent program); policies with no
  computed placement label as `Unplaced (Direct)`
  (`UNPLACED_TREATY_PROGRAM_LABEL`).
- `computePlacementForTransaction` (from #61) is on-demand, not auto-wired
  into bind/servicing transactions — most policies are expected to be
  Unplaced unless a placement was explicitly computed for them. This is
  documented behavior, not a bug: see docs/REINSURANCE_MODEL.md's
  "Deliberately Deferred: Automatic Lifecycle Wiring" section.
- `ExposureSummary.byTreatyProgram` and the CSV export's `treatyProgram`
  column expose the new dimension; `ExposurePage.tsx` renders it as a fourth
  group table.

## Follow-Ups Or Risks

- Historical (`asOf` in the past) exposure queries call `getPolicyState`
  once per matching policy (N+1). Acceptable for a first slice at
  demo/pilot book sizes; if this needs to scale to a large in-force book,
  consider a bulk timeline-state query or a periodically refreshed
  materialized exposure snapshot instead.
- ZIP is not available at all for homeowners beyond best-effort regex
  extraction from a free-text address; if precise ZIP-level aggregation
  becomes a hard requirement, the `dwelling` risk schema in
  `contracts/quote.request.schema.json` should gain a structured `zip`
  field.
- CSV export streams the same rows as the summary but is not paginated;
  fine for demo/pilot book sizes, would need streaming for very large
  exports.
