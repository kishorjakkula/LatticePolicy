# Task Note: Frontend Type-Checking

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/257
- Pull request: pending

## Summary

The frontend workspace now participates in the root TypeScript check. Enabling
strict checking exposed missing ambient types and several real defects, including
an incomplete ID-card document model and policy-page calls routed through the
wrong API objects.

## Important Files

- `frontend/package.json`: defines the frontend `typecheck` command.
- `frontend/tsconfig.json`: loads Vite, Vitest, and Node ambient types.
- `frontend/src/features/wizard/QuoteWizard.tsx`: supplies country to ID-card
  document generation.
- `frontend/src/features/policies/PolicyViewPage.tsx`: fixes API routing and
  adds explicit types to policy history and workflow helpers.

## Behavior Rules

- Keep frontend strict mode enabled; do not bypass errors with `@ts-nocheck`.
- The root `npm run typecheck` must execute the frontend workspace check.
- Generated ID-card dates must use the quote country, consistent with the
  other generated policy documents.
- Policy version details come from `apiDetails`; quote drafts come from `api`.

## Automated Tests

- Tests added or updated: no new runtime test; the new workspace typecheck is
  the regression check for the previously unchecked TypeScript paths.
- Test layer used: static TypeScript validation plus existing frontend tests.
- Why this layer is enough: the issue was caused by CI omitting frontend static
  analysis, and the existing component suite covers runtime frontend behavior.

## Validation

```bash
npm run typecheck
npm run build
npm run test --workspace=frontend
```

## Follow-Ups Or Risks

- Several legacy frontend APIs still return broad `any` payloads. Future API
  contract work can replace these with shared response types incrementally.
