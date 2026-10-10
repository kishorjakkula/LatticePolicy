# Underwriting Rules Admin UI

## Summary

Added a permission-gated administration page for tenant-authored underwriting
Refer and Decline rules. Products and allowed fields come from backend APIs;
the editor narrows operators and value controls using the curated field type.

## Behavior

- Read permission controls navigation and route access.
- Manage permission controls creating, editing, activation, and default
  seeding; read-only users never see mutation controls.
- Status reflects rules that are active and effective today, rather than
  counting inactive, expired, or future rules as enabled.
- The seed action calls only the dedicated underwriting-rule endpoint. A
  missing endpoint is surfaced instead of invoking unrelated reference-data
  seeding.
- API rows use the backend's snake_case representation; mutation payloads use
  the route's camelCase request contract.

## Important Files

- `frontend/src/features/admin/UnderwritingRulesPage.tsx`
- `frontend/src/api/admin.api.ts`
- `frontend/src/api/hooks/admin.hooks.ts`
- `frontend/src/features/admin/__tests__/UnderwritingRulesPage.test.tsx`

## Validation

- Frontend unit tests, typecheck, and production build
- CI, DB integration, Playwright, dependency, CodeQL, and container checks

