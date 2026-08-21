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
  aggregation with `asOf` support), `exposureRowsToCsv`.
- `server/src/routes/exposure.routes.ts`: `GET /summary` and
  `GET /export.csv`, mounted at `/api/v1/admin/exposure`.
- `server/src/routes/admin.routes.ts`: mounts the exposure router behind
  `admin.exposure.read`.
- `server/src/lib/rbac.ts`: new `menu.admin.exposure.view`,
  `page.admin.exposure.view`, `admin.exposure.read` permissions and a new
  `exposure_admin` role.
- `frontend/src/features/admin/ExposurePage.tsx`: filterable summary view
  (product/state/asOf) with by-product, by-state, and by-class/industry
  tables.
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
    `admin.exposure.read` RBAC enforcement — admin allowed, agent denied).
- Test layer used: unit tests for the pure extraction/CSV logic, DB-backed
  integration tests for tenant isolation, status filtering, and RBAC.
- Why this layer is enough: extraction/aggregation math is pure and cheap to
  verify without a database; tenant isolation and status filtering need a
  real Postgres row set to prove the SQL clauses are correct.

## Validation

```bash
npm run build
npm run test        # 78 frontend + 178 server passing
npm run typecheck
npm run test:integration   # 14 files / 47 tests passing against a disposable Postgres 15 container
```

Ran `test:integration` twice: once against a container reused across many
manual iterations (surfaced 3 unrelated pre-existing flaky failures in
`compliance-admin`, `customer-portal-security`, and `data-import` caused by
accumulated state from repeated manual runs, not by this change — confirmed
by re-running the same three files alone, which also failed, then
re-running the entire suite once against a completely fresh container,
where all 14 files/47 tests passed), and once clean against a fresh
container, which passed completely including this issue's 2 new tests.

## Follow-Ups Or Risks

- Treaty/program aggregation dimension (from the issue's expected scope) is
  not implemented: issue #61 (reinsurance treaty/facultative model) was
  developed in parallel and was not merged to `main` at the time this issue
  was implemented, so `policy_reinsurance_placements`/`reinsurance_treaties`
  tables were not available to join against. Once #61 merges, add an
  optional `treatyProgram` grouping to `computeExposureSummary` that joins
  `policy_reinsurance_placements` for policies that have a placement.
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
