# Issue 228: Treaty Layer And Participant Editing

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/228
- Pull request: pending

## Summary

Administrators can edit treaty layer terms and market participant shares. A
save creates a new effective-dated treaty version through the versioning path
introduced by issue #226.

## Important Files

- `frontend/src/features/admin/ReinsurancePage.tsx`: treaty version editor.
- `frontend/src/api/hooks/admin.hooks.ts`: update mutation and list refresh.
- `server/src/routes/reinsurance-admin.routes.ts`: nested participant reads,
  replacement-layer validation, and versioned child persistence.
- `server/src/__tests__/reinsurance.integration.test.ts`: DB-backed edit and
  rejected-share coverage.

## Behavior Rules

- Layer edits replace the complete layer/participant collection in a new
  treaty version; historical child rows remain unchanged.
- Participant shares must each be greater than zero and at most 100%, and
  their per-layer total cannot exceed 100%.
- Validation is enforced in both the UI and API; the API remains authoritative.
- Omitting layers from a treaty patch retains the issue #226 clone behavior.

## Automated Tests

- Frontend component tests cover a successful edit and client-side rejection.
- DB integration tests cover persisted terms, participants, effective-dated
  placement output, and atomic rejection of an over-subscribed edit.

## Validation

```bash
npm run test:integration
npm test
npm run typecheck
npm run build
npm run security:audit
```

## Follow-Ups Or Risks

- Facultative certificate participant editing remains separate future work.
