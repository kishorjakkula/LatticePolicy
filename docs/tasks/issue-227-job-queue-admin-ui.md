# Task Note: Job Queue Admin Dashboard UI

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/227
- Pull request:

## Summary

Adds slice 5 (the UI dashboard) of the batch/job queue framework
(issue #57, documented in `docs/JOB_QUEUE_DESIGN.md`), which was explicitly
called out as "not implemented." The backend API
(`server/src/routes/admin-jobs.routes.ts`) already existed with no server
changes required; this closes the gap by wiring a frontend admin page to it.

## Important Files

- `frontend/src/features/admin/JobsAdminPage.tsx` (new): a dedicated admin
  page with two panels — a read-only job definitions table, and a run
  history table with job-code/status filters, a "View" action that expands
  a run's event log and last error, and a "Retry" action shown only for
  runs with `status === 'DeadLettered'` (the only status the backend's
  `POST /runs/:runId/retry` endpoint accepts; other statuses 409).
- `frontend/src/api/admin.api.ts`: added `listJobDefinitions`, `listJobRuns`,
  `getJobRun`, `retryJobRun` client functions mirroring the existing
  compliance/reinsurance/bordereaux API blocks.
- `frontend/src/api/queryKeys.ts`: added a `jobs` key factory
  (`definitions`, `runs`, `run`).
- `frontend/src/api/hooks/admin.hooks.ts`: added `useJobDefinitions`,
  `useJobRuns`, `useJobRun`, `useRetryJobRunMutation` following the
  existing query/mutation hook patterns; the retry mutation invalidates
  the `['jobs', 'runs']` query key on success.
- `frontend/src/features/admin/AdminShell.tsx`: added a "Jobs" nav link
  gated on `menu.admin.jobs.view`, following the exact pattern of every
  other admin sub-area link.
- `frontend/src/App.tsx`: added the lazy-loaded route
  `/admin/jobs` gated on `page.admin.jobs.view`.
- `frontend/src/auth/permissions.ts`: fixed a pre-existing gap — the
  `admin` role's default permission list was missing
  `menu.admin.jobs.view`, `page.admin.jobs.view`, `admin.jobs.read`, and
  `admin.jobs.manage`, even though `server/src/lib/rbac.ts`'s `admin` role
  (`[...ALL_PERMISSION_CODES]`) already granted them server-side. Without
  this fix, admin users would not have seen the new nav link or been able
  to reach the page client-side, despite being authorized by the backend.
  Also added a frontend `jobs_admin` role block mirroring the server's
  `jobs_admin` role (same four permission codes plus `menu.admin.view`),
  matching every other single-purpose admin role already defined in this
  file (`compliance_admin`, `reinsurance_admin`, `bordereaux_admin`, etc.).

## Design Decisions

- Built as a **dedicated page** rather than a new panel on
  `OperationsDashboardPage.tsx`. The RBAC catalog already defines distinct
  `menu.admin.jobs.view` / `page.admin.jobs.view` permissions separate from
  the dashboard's permissions, and every other admin sub-area
  (Compliance, Reinsurance, Bordereaux, ...) follows the one-page-per-area
  convention with its own menu/page permission pair — a dedicated page is
  consistent with that existing structure.
- Run history defaults to `limit=100` (server clamps to 200 max) with no
  pagination UI; this matches the issue's stated scope and the existing
  `OperationsDashboardPage` panels, which also render a single bounded
  page of rows without pagination controls.
- The "Retry" action is a plain button, not a confirmation prompt (unlike
  `CompliancePage`'s OFAC disposition flow, which prompts for a reason)
  because the retry endpoint takes no reason/payload — it only requires
  the run to be `DeadLettered`, which the UI already enforces by only
  rendering the button in that state.

## Automated Tests

- Tests added or updated:
  - `frontend/src/features/admin/__tests__/JobsAdminPage.test.tsx` —
    renders definitions and run rows; empty state when there are no runs;
    error state when the runs query fails; verifies Retry only renders for
    `DeadLettered` rows; verifies clicking Retry calls the mutation with
    the run id; verifies clicking View opens the run detail panel.
- Test layer used: frontend component test with all data hooks mocked via
  `vi.mock('../../../api/hooks', ...)`, following the exact pattern of
  `CompliancePage.test.tsx`.
- Why this layer is enough: the page is a straightforward
  fetch/render/mutate composition over an already-tested backend API
  (`server/src/routes/admin-jobs.routes.ts` has its own coverage); a
  component test proves the UI renders and wires actions correctly without
  re-testing the API contract.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

## Follow-Ups Or Risks

- No pagination or date-range filtering on the run history table; if job
  volume grows large, the fixed `limit=100` view may not be enough to find
  older runs. A follow-up could add pagination or a date filter.
- The "manual enqueue" endpoint (`POST /runs`) is not exposed in this UI —
  the issue scoped this page to visibility (definitions/runs) and retry,
  not ad-hoc job triggering. That could be a small follow-up if operators
  want to manually kick off a run from the dashboard.
