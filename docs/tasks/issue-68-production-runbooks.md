# Task Note: Production Runbooks

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/68
- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/159

## Summary

Added `docs/PRODUCTION_RUNBOOKS.md`, an operator-facing runbook covering
deployment promotion, migration execution/rollback, database backup/restore
and point-in-time recovery, Redis cache recovery, health checks/smoke tests,
observability alarms, incident response, and RPO/RTO assumptions with a
validation checklist. It complements, rather than duplicates,
`docs/CLOUD_DEPLOYMENT.md` (provisioning/setup) and `docs/RELEASE_PROCESS.md`
(release cadence and versioning).

## Important Files

- `docs/PRODUCTION_RUNBOOKS.md`: the new runbook.
- `README.md`: links the new doc from the documentation index.

## Behavior Rules

- Migrations in `server/migrations/` are forward-only and run automatically
  at API process startup (`initDb()` -> `runMigrations()` in
  `server/src/db.ts`), tracked via the `schema_migrations` table. There is no
  down-migration mechanism; rollback of a migration-involved regression means
  either a forward-fix migration or a database restore, not a schema
  reversal.
- Multi-replica production deployments must not let every replica run
  migrations independently at boot — migrations should be run as a single
  deliberate step before updating replicas, since there is no distributed
  migration lock today.
- Redis is a read-through cache with no backup/restore requirement; only
  PostgreSQL is a system-of-record backup target.

## Automated Tests

- Tests added or updated: none.
- Test layer used: documentation review.
- Why this layer is enough: this is a documentation-only change; no runtime
  behavior changed.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

## Follow-Ups Or Risks

- No automated restore-test script exists yet; the runbook calls this out as
  needed follow-up automation rather than fabricating one.
- No migration-lock mechanism exists for safe multi-replica migration runs;
  documented as a manual operational requirement and flagged as follow-up
  automation.
- Production smoke tests are documented but not yet wired into the AWS/Azure
  deployment workflows as an automated post-deploy step.
