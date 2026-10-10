# Forms Template Upload UI

## Summary

Extended Forms Management with DOCX template upload feedback and a grouped
reference of supported policy-document merge fields.

## Behavior

- PDF uploads keep their existing behavior.
- DOCX upload success lists recognized placeholders.
- Validation failures display the exact rejected placeholders returned by the
  backend when available.
- The variable catalog is read-only and loaded from the server contract.

## Important Files

- `frontend/src/features/admin/FormsManagementPage.tsx`
- `frontend/src/api/admin.api.ts`
- `frontend/src/api/hooks/admin.hooks.ts`
- `frontend/src/features/admin/__tests__/FormsManagementPage.templateVariables.test.tsx`

## Validation

- Frontend unit and accessibility tests
- Typecheck, production build, CI, Playwright, security, and container checks

