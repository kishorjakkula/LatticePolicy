# Task Note: Operational Admin Dashboards

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/58
- Pull request:

## Summary

Added a read-only operations dashboard that aggregates operational failures
and pending work from existing subsystems into one admin page: async outbox
delivery failures, notification delivery failures, the OFAC review queue, and
open underwriting referrals. The dashboard reuses the existing
compliance-admin and UW-referral data instead of duplicating that business
logic — it only adds new read endpoints for the two data sources that didn't
already have an admin-facing list API (outbox, notifications).

## Important Files

- `server/src/routes/admin-dashboard.routes.ts`: new aggregate `/summary`
  endpoint plus `/outbox` and `/notifications` list endpoints, tenant-scoped
  via `withTenantTx`.
- `server/src/routes/admin.routes.ts`: mounts the new routes at
  `/admin/dashboard`, gated by `admin.dashboard.read`.
- `server/src/lib/rbac.ts`: adds `menu.admin.dashboard.view`,
  `page.admin.dashboard.view`, and `admin.dashboard.read` permissions. No new
  role — the existing `admin` role receives every permission automatically.
- `frontend/src/features/admin/OperationsDashboardPage.tsx`: summary cards
  plus four panels (outbox, notifications, OFAC, UW referrals). The OFAC and
  UW referral panels reuse the existing `useOfacScreens` /
  `useUwReferrals` hooks and their underlying permissions instead of adding
  parallel read paths.
- `frontend/src/features/admin/AdminShell.tsx`, `frontend/src/App.tsx`,
  `frontend/src/auth/permissions.ts`: navigation, routing, and the
  client-side permission default list.

## Behavior Rules

- The dashboard summary and list endpoints only read; all mutations (OFAC
  disposition, referral assignment/decision, outbox/notification retry)
  still happen through their existing dedicated admin pages/APIs.
- All dashboard queries are tenant-scoped through `withTenantTx`; a user in
  one tenant cannot see another tenant's outbox, OFAC, or notification rows
  (covered by an integration test).
- Access requires `admin.dashboard.read`. A user who only has that permission
  (and not `admin.compliance.read` or `uw.referrals.read`) will see the
  outbox/notifications panels but the OFAC/referral panels will show their
  own error state — this is intentional per-domain RBAC, not a bug, and only
  the built-in `admin` role has all four by default today.
- "Batch job status" from the issue's expected scope depends on issue #57
  (batch/scheduler framework). At the time this was implemented, no
  `job_runs` table or admin jobs route existed yet, so that panel was left
  out rather than building the job framework as part of this issue. Add a
  jobs panel here once #57 lands.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/admin-dashboard.integration.test.ts` (RBAC denial,
    tenant isolation on outbox data, notification failure listing)
  - `frontend/src/features/admin/__tests__/OperationsDashboardPage.test.tsx`
    (summary rendering, empty states, a populated row with a source-record
    link, and an error state)
- Test layer used: server DB-backed integration test plus a frontend
  component test.
- Why this layer is enough: the endpoints are thin, tenant-scoped
  aggregation queries over existing tables, so a real-DB integration test
  proves tenant isolation and RBAC directly; the frontend test proves the
  page renders each state correctly against mocked hooks.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration
```

All four passed, including the 32/32 DB-backed integration suite (run
against a disposable Postgres 15 container via the repo's own
`test:integration` script).

## Follow-Ups Or Risks

- Add a batch job status panel once issue #57 (batch/scheduler framework)
  lands.
- Consider adding `admin.dashboard.read` to `compliance_admin` /
  `notification_admin` / `underwriter` roles if operators without full admin
  access should see a scoped version of this dashboard.
- No pagination or date-range filtering on the outbox/notifications panels
  yet; both are capped at the 200 most recent matching rows, which is fine
  for the intended "recent failures" use case but would need pagination for
  a high-volume production tenant.
