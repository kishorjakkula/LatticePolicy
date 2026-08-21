# Task Note: Large Commercial Placement And Subscription Workflow

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/64
- Pull request:

## Summary

Added a large commercial / reinsurance-style placement and subscription
workflow that runs alongside, not instead of, the standard single-carrier
quote/bind flow. A placement tracks a submission through
Submission -> Indication -> Quoted -> BindOrder -> Bound -> Issued (with
Declined/Withdrawn as early exits), records multiple subscribing market
participants and their shares, tracks subjectivities to resolution, and
optionally references a quote pre-bind and the resulting policy once bound.

## Important Files

- `server/migrations/043_large_commercial_placement.sql`: `commercial_placements`,
  `placement_market_participants`, `placement_subjectivities` tables, all
  tenant-scoped with RLS.
- `server/src/services/placement.service.ts`: create/list/get placement,
  market participant + subjectivity management, and status transition
  enforcement.
- `server/src/routes/placement.routes.ts`: `/v1/placements` API surface,
  gated by new `placement.read` / `placement.manage` permissions.
- `server/src/lib/rbac.ts`: new `menu.placements.view`, `page.placements.view`,
  `placement.read`, `placement.manage` permissions, granted to the
  `underwriter` role.
- `docs/PROJECT_CONTEXT.md`: "Standard Quote Flow Versus Large Commercial
  Placement" section explaining when to use which flow.
- `frontend/src/features/placements/PlacementsPage.tsx`: list/create/status-
  transition UI at `/placements`, gated by `page.placements.view`.
- `frontend/src/api/placements.api.ts`, `frontend/src/api/hooks/placements.hooks.ts`:
  frontend API client and React Query hooks for the placement API.

## Behavior Rules

- The standard quote/bind flow is completely unaffected — this is additive,
  not a replacement or gate.
- Status transitions follow a strict allow-list (see
  `ALLOWED_TRANSITIONS` in `placement.service.ts`); invalid transitions,
  including any transition out of a terminal status (`Issued`, `Declined`,
  `Withdrawn`), are rejected with `INVALID_PLACEMENT_TRANSITION`.
- A placement's market participants' `subscription_percent` values may never
  sum to more than 100%; adding a participant that would push the total over
  100% is rejected with `PLACEMENT_OVERSUBSCRIBED`. Individual shares must be
  in `(0, 100]`.
- `policy_id` is only ever set on the `Bound` transition (via `COALESCE`, so
  it is a one-way link once set).
- Placement documents are recorded as a lightweight `documents` jsonb array
  on the placement itself (mirroring the existing
  `policy_transactions.documents` convention), since a placement commonly
  exists before any policy/transaction row exists to attach a `documents`
  row to.
- Every table is tenant-scoped with RLS; queries always run inside
  `withTenantTx`.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/placement.service.test.ts` (unit — share
    validation and status transition rules, including terminal-state and
    missing-placement cases, using a mocked `__pgClient`)
  - `server/src/__tests__/placement.integration.test.ts` (DB integration —
    full create -> add participants -> oversubscription rejection ->
    subjectivity -> transition -> resolve -> BindOrder flow; Declined
    terminal-state rejection; tenant isolation)
  - `frontend/src/features/placements/__tests__/PlacementsPage.test.tsx`
    (component — permission-gated actions, terminal-status hides actions,
    empty state)
- Test layer used: server unit tests for pure validation/transition logic,
  DB-backed integration tests for persistence, RLS tenant isolation, and the
  full workflow sequence (required by the issue's acceptance criteria).
- Why this layer is enough: the validation and transition rules are pure
  enough to unit test without a database; the multi-step workflow and tenant
  isolation genuinely need a real Postgres instance with RLS active.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration   # against a disposable local postgres:15 container
```

All green: 82 frontend + 179 server unit tests, typecheck clean, and 14
integration test files / 48 tests (including the 3 new placement tests)
passing against a disposable Postgres 15 container.

## Follow-Ups Or Risks

- The frontend page covers list/create/status-transition only — participant
  and subjectivity management (add/resolve) are API-complete but have no UI
  yet; a follow-up could add a placement detail view for that.
- The placement's `policy_id` link is populated when a caller supplies it on
  the `Bound` transition, but the standard quote/bind/endorsement services do
  not yet call this workflow automatically — a follow-up could wire an
  optional "convert Bound placement to policy bind" helper once real
  large-commercial product/rating support exists for multi-market business.
- `agent` role does not get `placement.read`/`placement.manage` by default in
  this slice (only `underwriter` and `admin`); revisit role grants once real
  broker/agent placement-creation workflows are defined.
- This migration is numbered `043`, the same next-available number issue
  #61's reinsurance model PR (#167) also claimed while both were developed
  in parallel off the same base — whichever merges second will need
  renumbering to avoid a collision, consistent with how prior parallel
  migration collisions in this session were resolved (see PRs #164, #165).
