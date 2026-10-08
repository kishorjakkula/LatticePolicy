# Underwriting Authority Admin Page

## Summary

Added an administration page for viewing and maintaining effective-dated
underwriting authority grants. The page also shows whether authority gating is
configured for a selected product and state scope, making the backend's
intentional fail-open behavior visible to administrators.

## Behavior

- Users need `uw.authority.read` to open the page or see its navigation item.
- Users need `uw.authority.manage` to create, deactivate, or reactivate grants.
- Product and state values left blank on a grant act as wildcards.
- A scope with no active, effective matching grant is reported as gating off,
  matching `resolveAuthorityDecision` on the server.

## Important Files

- `frontend/src/features/admin/UnderwritingAuthorityPage.tsx`
- `frontend/src/api/uw.api.ts`
- `frontend/src/api/hooks/uw.hooks.ts`
- `frontend/src/features/admin/__tests__/UnderwritingAuthorityPage.test.tsx`

## Validation

- Frontend unit tests
- TypeScript typecheck
- Production build
- CI, DB integration, Playwright, dependency, CodeQL, and container checks

