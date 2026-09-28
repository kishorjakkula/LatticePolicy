# Issue 226: Reinsurance Treaty Version History

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/226
- Pull request: pending

## Summary

Treaty edits now preserve history by creating a linked version instead of
updating the existing treaty row. Effective-dated placement lookup selects the
correct version for each policy transaction.

## Important Files

- `server/src/routes/reinsurance-admin.routes.ts`: atomically clones treaties,
  layers, and participants and links the superseded version.
- `server/src/services/reinsurance.service.ts`: resolves the highest effective
  version in each treaty chain before applying placement rules.
- `server/src/__tests__/reinsurance.integration.test.ts`: proves version links,
  child cloning, current-list behavior, and historical/current placement.
- `docs/REINSURANCE_MODEL.md`: defines API and effective-dating semantics.

## Behavior Rules

- Treaty rows are immutable after creation; PATCH creates the next version.
- Only a current, unsuperseded treaty ID may be edited.
- Layers and participants receive new IDs on each version so historical
  placement references remain stable.
- `effectiveDate` should be supplied for prospective changes. Omitting it
  preserves the prior date for backward-compatible replacement behavior.
- The standard treaty list returns only current version-chain leaves.

## Automated Tests

- Updated `server/src/__tests__/reinsurance.integration.test.ts`.
- DB-backed integration coverage is used because the behavior spans an API
  transaction, multiple related tables, and effective-dated placement lookup.

## Validation

```bash
npm run test:integration
npm run test
npm run typecheck
npm run build
npm run security:audit
```

## Follow-Ups Or Risks

- Issue #228 can build layer and participant editing on this versioned path.
- A dedicated history endpoint is not included; normal listing intentionally
  exposes only current versions.
