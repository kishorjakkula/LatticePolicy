# Task Note: Notification Template Admin CRUD

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/87
- Pull request:

## Summary

Added admin CRUD, activate/deactivate, and preview-rendering APIs plus an
Administration UI page for `notification_templates`, the table already used
by the runtime notification framework (`server/src/services/notification.service.ts`,
see `docs/tasks/notification-notice-framework.md`). Administrators can now
manage tenant/product/transaction-specific notification templates without
direct database changes, closing the explicit follow-up noted in that earlier
task note.

## Important Files

- `server/src/services/notification-template-admin.service.ts`: list/get/create/update/
  activate/deactivate persistence and input validation, plus a pure preview
  renderer that reuses `renderNotificationTemplate` from `notification.service.ts`
  so previews match production rendering exactly.
- `server/src/routes/notification-templates.routes.ts` (re-exported via
  `server/src/notificationTemplates.ts`): admin-permission-gated REST routes,
  mounted at `/api/v1/admin/notification-templates`.
- `server/src/routes/admin.routes.ts`: mounts the new sub-router behind
  `admin.notifications.read`.
- `server/src/lib/rbac.ts`: adds `menu.admin.notifications.view`,
  `page.admin.notifications.view`, `admin.notifications.read`,
  `admin.notifications.manage`, and a new `notification_admin` system role.
- `frontend/src/auth/permissions.ts`: mirrors the same permission codes and role
  for the local/demo fallback path (kept in sync with `server/src/lib/rbac.ts`).
- `frontend/src/features/admin/NotificationTemplatesPage.tsx`: list/create/edit/
  activate-deactivate/preview UI, following the existing `AdministrationPage.tsx`
  (UW Company) pattern.
- `frontend/src/App.tsx`, `AdminShell.tsx`, `components/RouteGuards.tsx`: route,
  nav link, and admin-index-redirect wiring for the new page.
- `frontend/src/api/admin.api.ts`, `api/hooks/admin.hooks.ts`, `api/queryKeys.ts`:
  client + React Query hooks for the new endpoints.

## Behavior Rules

- No new table or migration was needed: `notification_templates` (migration
  `034_notification_framework.sql`) already had every field this issue's scope
  asked for (event type, channel, product, transaction type, locale,
  effective/expiration dates, subject/body templates, visibility, metadata).
- `channel` is currently restricted to `EMAIL` at the validation layer, matching
  what the runtime notification service actually delivers today; the DB column
  itself is unrestricted text for when other channels are added.
- Preview rendering (`POST /admin/notification-templates/preview`) is a pure,
  non-persisting operation that reuses the exact same `renderNotificationTemplate`
  helper the runtime uses, so what an admin previews is what will render at
  send time.
- Deactivating a template (`active = false`) immediately removes it from
  `loadTemplate()`'s runtime selection query in `notification.service.ts`
  (which already filters on `active = true`); no separate runtime change was
  required for this.
- `PATCH` accepts partial payloads; unspecified fields are left unchanged by
  merging onto the current row before writing.
- Duplicate `(tenant_id, template_code)` on create/update maps the DB unique
  violation (`23505`) to a `409 DUPLICATE` response instead of a raw 500.

## Automated Tests

- Tests added:
  - `server/src/services/__tests__/notification-template-admin.service.test.ts`
    (unit: validation rules, query/param construction, row mapping, duplicate
    conflict mapping, pure preview rendering).
  - `server/src/__tests__/notification-template-admin.integration.test.ts`
    (DB-backed: permission enforcement via `notification_admin` vs `agent` role,
    full CRUD + activate/deactivate + preview through the real Express app, and
    an end-to-end check that issuing a policy picks up an active custom
    `POLICY_ISSUED` template and falls back to the built-in default once that
    template is deactivated).
  - `frontend/src/features/admin/__tests__/NotificationTemplatesPage.test.tsx`
    (component: list/empty states, edit-populates-form, create submit payload,
    deactivate action, preview rendering).
- Test layer used: unit + DB integration + frontend component, per
  `docs/TEST_PLAN.md`'s mapping for API/RBAC/tenant-scope and persistence
  changes.
- Why this layer is enough: the unit test isolates validation and query
  construction without a database; the integration test is what actually
  proves tenant isolation, RBAC enforcement, and the runtime template
  selection/fallback behavior against real Postgres (run via
  `npm run test:integration`, which spins up a disposable Postgres container
  through Docker).

## Validation

```bash
npm run build
npm run test
npm run test:integration
```

All three passed locally (Node 20.20.2, Docker available for the integration
Postgres container).

## Follow-Ups Or Risks

- Additional delivery channels (SMS, push, etc.) are out of scope here; the
  `channel` validator would need to expand alongside actual runtime delivery
  support.
- The admin UI does not yet expose a "duplicate/clone template" action; today
  cloning requires manually re-entering fields, unlike the forms-admin clone
  flow.
- Integration tests share the `sample-carrier` tenant across test cases in the
  same file. The "create/update/activate" test intentionally ends with its
  template deactivated so it cannot shadow the built-in default template used
  by the separate runtime-selection test's fallback assertion.
