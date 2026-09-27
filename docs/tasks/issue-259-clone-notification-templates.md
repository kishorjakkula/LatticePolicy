# Issue 259: Clone Notification Templates

## Summary

Notification administrators can clone an existing template from the list. The
server creates a new inactive record with the same content and targeting fields,
then the UI immediately opens the copy for editing.

## Behavior

- Clone codes use `<source>-copy`, then `<source>-copy-2`, and so on.
- Clones are always inactive to prevent duplicate live notification matching.
- The clone remains tenant-scoped and requires `admin.notifications.manage`.
- Metadata records `clonedFromTemplateId` and the creating actor.
- The source template is not changed.

## Main Files

- `server/src/services/notification-template-admin.service.ts`
- `server/src/routes/notification-templates.routes.ts`
- `frontend/src/features/admin/NotificationTemplatesPage.tsx`
- `frontend/src/api/admin.api.ts`
- `frontend/src/api/hooks/admin.hooks.ts`

## Tests

- DB integration verifies copied content, inactive status, metadata, and unique
  sequential copy codes.
- Frontend coverage verifies the Clone action calls the API and opens the copy
  in edit mode.

## Validation

```bash
npm run test --workspace=server
npm run test --workspace=frontend
npm run test:integration
npm run typecheck
npm run build
npm run security:audit
```
