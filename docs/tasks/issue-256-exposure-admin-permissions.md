# Task Note: Exposure Administrator Frontend Permissions

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/256
- Pull request: pending

## Summary

Added the missing frontend permission fallback for the server-defined
`exposure_admin` role. A user assigned only this role can now see the
Administration and Exposure navigation and pass the `/admin/exposure` route
guard even when the login response does not include explicit permissions.

## Important Files

- `frontend/src/auth/permissions.ts`: mirrors the backend role's four
  permission codes.
- `frontend/src/auth/__tests__/permissions.test.ts`: locks in the role mapping
  and verifies menu, page, and API-read access.

## Behavior Rules

- Frontend role defaults must mirror `server/src/lib/rbac.ts` exactly.
- `exposure_admin` receives read access only; it must not inherit
  `admin.exposure.manage`.
- Backend authorization remains authoritative. Frontend defaults control
  navigation and route visibility for known system roles.

## Automated Tests

- Unit tests verify the exact sorted permission list and all permissions used
  by the Exposure navigation and route guard.

## Validation

```bash
npm run test --workspace=frontend
npm run typecheck
npm run build
```

## Follow-Ups Or Risks

- Role definitions still exist in separate frontend and backend files. A
  future shared contract or drift check could detect all role mismatches
  automatically.
