# Task Note: Reinsurance Treaty And Facultative Placement Model

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/61
- Pull request:

## Summary

Added the first reinsurance data model and service interface: treaty/layer/
facultative certificate/market participant tables, a placement lookup and
compute service, admin CRUD APIs, and a minimal admin UI. This is foundational
work — issues #60 (ACORD/GRLC mapping), #62 (bordereaux generation), #63
(exposure management), and #64 (large commercial placement) are expected to
build on the schema and `lookupPlacementMatches`/`computePlacementForTransaction`
service interface documented in `docs/REINSURANCE_MODEL.md` rather than
re-deriving treaty matching logic.

## Important Files

- `server/migrations/043_reinsurance_treaty_facultative.sql`: programs,
  treaties, layers, facultative certificates, market participants, and the
  computed `policy_reinsurance_placements` output table — all tenant-scoped
  with RLS.
- `server/src/services/reinsurance.service.ts`: `lookupPlacementMatches`,
  `computePlacementForTransaction`, `validateParticipantShares`,
  `treatyApplies`. See `docs/REINSURANCE_MODEL.md` for the full interface
  contract.
- `server/src/routes/reinsurance-admin.routes.ts`: admin CRUD + compute API,
  mounted at `/api/v1/admin/reinsurance` in `server/src/routes/admin.routes.ts`.
- `server/src/lib/rbac.ts`: `admin.reinsurance.read`/`admin.reinsurance.manage`
  permissions and the `reinsurance_admin` role.
- `frontend/src/features/admin/ReinsurancePage.tsx`: treaty and facultative
  certificate CRUD UI.
- `docs/REINSURANCE_MODEL.md`: schema, service interface, and explicit scope
  boundaries (no settlement accounting, no automatic lifecycle wiring, no
  attachment-point stacking math).

## Behavior Rules

- A facultative certificate covering a policy as of the transaction's
  effective date takes precedence over treaty matches; treaty layers are not
  also returned in that case.
- Treaty applicability is Active status + effective/expiration window +
  optional product/state filters (`NULL`/empty array = applies to all).
- Market participant shares are validated to be individually positive, at
  most 100%, and not sum to more than 100% across a single layer or
  facultative certificate; under-placement is allowed.
- `computePlacementForTransaction` is idempotent per transaction — it deletes
  and replaces prior placement rows for that transaction rather than
  accumulating duplicates.
- Placement computation is NOT automatically triggered by bind/issue/
  endorsement/etc. lifecycle services — it is exposed as an on-demand admin
  API call. See "Deliberately Deferred" in `docs/REINSURANCE_MODEL.md` for
  why.
- No reinsurance accounting settlement logic exists or is planned as part of
  this issue.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/reinsurance.service.test.ts` (12 unit
    tests: participant share validation, treaty applicability matching).
  - `server/src/__tests__/reinsurance.integration.test.ts` (5 DB integration
    tests: treaty+layer+participant creation and matching, product
    applicability non-match, facultative override precedence, over-100%
    share rejection, RBAC/tenant denial).
  - `frontend/src/features/admin/__tests__/ReinsurancePage.test.tsx` (4
    component tests: treaty list rendering, treaty creation, facultative tab
    switch, facultative certificate creation).
- Test layer used: unit tests for pure matching/validation logic, DB-backed
  integration tests for the full create → match → compute flow (required by
  the issue's acceptance criteria: "Tests cover treaty lookup and facultative
  override behavior"), frontend component tests for the admin UI.
- Why this layer is enough: the matching/validation rules are pure and cheap
  to verify directly; the create/match/compute flow genuinely needs a real
  Postgres instance because it exercises RLS, JSON aggregation, and
  multi-table joins.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration   # ran against a disposable local postgres:15 container
```

## Follow-Ups Or Risks

- Treaty term versioning (`version`/`superseded_by`) is schema-only; no
  service logic creates new versions yet.
- No UI for editing layers/participants after initial treaty creation.
- Layer stacking/attachment-point math across multiple matched layers is not
  modeled — each matched layer is reported independently.
- Deciding the real trigger point for automatic placement computation (bind,
  every servicing transaction, batch cadence) is left to #62/#64.
