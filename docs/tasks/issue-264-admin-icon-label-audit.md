# Issue 264: Admin Icon Label Audit

## Summary

Audited `RatingWorkbenchPage` and `FormsManagementPage` for icon-only controls
without accessible names. No unlabeled controls were found. Rating Workbench
currently uses text-labeled actions; Forms Management's icon-only View and Edit
actions already use record-specific `aria-label` values.

## Tests

- `RatingWorkbenchPage.accessibility.test.tsx` renders model/version data and
  asserts every button has an accessible name.
- `FormsManagementPage.accessibility.test.tsx` verifies the icon-only View and
  Edit names and asserts every rendered button has an accessible name.

These page-level tests prevent a future icon-only action from being added
without a screen-reader name.

## Validation

```bash
npm run test --workspace=frontend
npm run typecheck
npm run build
```
