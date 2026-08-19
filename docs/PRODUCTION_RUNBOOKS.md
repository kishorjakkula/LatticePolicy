# Production Runbooks

This document gives carrier operators step-by-step operational procedures for
running LatticePolicy in production: release/rollback, database migrations,
backup/restore, cache recovery, health checks, incident response, and
disaster recovery expectations.

This is a runbook, not a deployment guide. For provisioning cloud
infrastructure and initial setup, see [Cloud Deployment](CLOUD_DEPLOYMENT.md).
For how release branches, versioning, and GitHub releases work, see
[Release Process](RELEASE_PROCESS.md). This document assumes that
infrastructure already exists and focuses on what an operator does during a
release or an incident.

## Deployment Promotion Process

LatticePolicy does not ship a built-in multi-environment promotion pipeline.
Operators should run the same immutable container images through each
environment in order, only promoting after the previous environment's smoke
tests pass:

1. **Dev** — deploy on every merge to `main` (or on demand) for active
   development. Data may be reset at any time.
2. **Test/Stage** — deploy a specific release tag (see
   [Release Process](RELEASE_PROCESS.md)) manually or via a protected
   workflow. Run the full smoke test list below before promoting further.
   Stage should use production-shaped configuration (`DEPLOYMENT_ENV`,
   managed Postgres/Redis, real secrets) so migration and config issues
   surface before production.
3. **Production** — deploy the same image tag and Git SHA that passed
   staging. Never build a new image directly for production; promote the
   artifact that was already tested.

Do not promote a tag until:

- CI (`build`, `test`, `typecheck`) is green on `main` for that commit.
- `npm run test:integration` and `npm run test:e2e:docker` have passed for
  that commit (see [Release Process](RELEASE_PROCESS.md) quality gate).
- The previous environment's smoke tests (below) pass on the same image.

## Migration Execution And Rollback

Migrations live under `server/migrations/` as numbered, forward-only SQL
files (`NNN_description.sql`). They are **not** run as a separate CLI step —
`initDb()` in `server/src/db.ts` runs `runMigrations()` automatically on API
process startup: it reads `server/migrations/`, checks the `schema_migrations`
tracking table for versions already applied, and executes any new migration
files in numeric order inside a single `pool.query` per file.

Operational implications:

- **No down-migrations exist.** There is no automated rollback of a schema
  change. Treat every migration as one-way.
- **Do not run multiple API replicas against an unmigrated database
  simultaneously.** Because migrations run at process boot with no
  distributed lock, a rolling deploy where several replicas start against the
  same empty/partial `schema_migrations` state can race. For a multi-replica
  production deployment, run migrations as a single, deliberate step (a
  one-off task using the API image, or a CI/CD deployment stage with direct
  database access — see [Cloud Deployment](CLOUD_DEPLOYMENT.md#database-migrations))
  **before** starting or updating any replica, not by letting each replica
  migrate itself.
- **Review every new migration file for tenant isolation and repeatability**
  before it ships in a release, per [Release Process](RELEASE_PROCESS.md#migration-compatibility).

### Rollback Guidance

Because migrations are forward-only, "rollback" for a bad release means one
of two things:

1. **Application-only regression (no risky migration involved):** redeploy
   the previous known-good image tag. The database schema is unaffected.
   This is the fast path and should be preferred whenever the failing
   release did not ship a migration that other code now depends on.
2. **Migration-involved regression:** do not attempt to run new SQL to "undo"
   a shipped migration under incident pressure. Prefer a forward-fix
   migration (a new, reviewed migration file that repairs or supersedes the
   problem) over hand-editing schema state. If the migration caused data
   loss or corruption, restore from backup instead (see below) rather than
   attempting a manual schema reversal.

Before shipping any migration that changes or removes a column/table used by
the currently-deployed application version, confirm the change is backward
compatible with the previous release for at least one deployment cycle
(expand/contract pattern), so a same-schema rollback of the application stays
possible.

## Database Backup, Restore, And Point-In-Time Recovery

LatticePolicy does not include managed backup automation in this repository
— PostgreSQL is the system of record and backup/restore is the operator's
responsibility using their hosting provider's tooling. This section defines
what to configure and how to validate it, using the managed-service options
already named in [Cloud Deployment](CLOUD_DEPLOYMENT.md) (Amazon RDS, Azure
Database for PostgreSQL Flexible Server, Cloud SQL).

### Backups

- Enable automated daily backups plus continuous WAL archiving on the managed
  Postgres service (RDS automated backups, Azure Flexible Server backups, or
  Cloud SQL automated backups all support this) so point-in-time recovery
  (PITR) is available, not just daily snapshots.
- Set a backup retention window that matches your compliance/regulatory
  requirement for policy and transaction records — insurance data typically
  requires multi-year retention; the managed backup retention window is
  usually shorter, so pair it with a periodic exported snapshot to
  colder/longer-term storage if your retention requirement exceeds the
  managed service's maximum backup window.
- Enable deletion protection on the production database instance.

### Restore

1. Identify the target: either the latest automated backup, or a specific
   point in time within the WAL-archiving retention window.
2. Restore into a **new** database instance — never restore over the live
   production instance in place.
3. Point a non-production API instance (`DATABASE_URL` pointed at the
   restored instance, `DEPLOYMENT_ENV` set to a non-production value) at the
   restored database and confirm:
   - the API starts and `GET /health` returns healthy,
   - `schema_migrations` reflects the expected applied version,
   - a small set of known tenants/policies are queryable and their data
     looks correct as of the restore point.
4. Only after validation, cut production traffic to the restored instance (or
   copy the validated data back into the original instance's location,
   depending on your provider's failover mechanics).

### Restore Testing

Treat restore as untested until it has been exercised. At minimum:

- Run a full restore-and-validate pass (steps above) on a non-production
  copy of the backup on a recurring schedule (for example, quarterly, or
  before any major release that includes a risky migration).
- Track the last successful restore-test date. A backup that has never been
  restored should not be treated as a satisfied recovery objective.

There is no automated restore-test script in this repository yet. Adding one
(a scripted "restore latest backup into a scratch instance, run migrations
check + smoke query, report pass/fail") is valuable follow-up automation —
track it as a separate issue rather than a manual runbook step long-term.

## Redis/Cache Recovery

Redis is a read-through cache, not a source of truth. `CACHE_ENABLED=1` and
`REDIS_URL` control whether it's used at all; the application is expected to
continue functioning (at reduced performance) if the cache is cold or
unavailable, since data is re-derived from PostgreSQL on a cache miss.

Recovery expectations:

- **Cache loss requires no restore procedure.** If a Redis instance is lost
  or flushed, simply provision a replacement (or let the managed service
  recover it) and point `REDIS_URL` at it. No data migration or backup/restore
  step applies to cache state.
- Do not configure Redis persistence/backups as a substitute for PostgreSQL
  backups — no policy, transaction, or tenant data should ever exist only in
  Redis.
- If Redis is unreachable, confirm the API's behavior degrades gracefully
  (falls through to PostgreSQL) rather than failing requests; this should be
  covered by existing cache-layer tests, not re-verified manually per
  incident.

## Health Checks And Smoke Tests

- `GET /health` on the API container is the platform health check target
  (already wired into `docker-compose.prod.yml` and referenced in
  [Cloud Deployment](CLOUD_DEPLOYMENT.md)). Load balancer / container
  platform health checks should point here.
- Frontend health check: `GET /` on the frontend container should return the
  built app shell (200).

Run this smoke test list after every deploy, before shifting full production
traffic (matches and extends the list in
[Cloud Deployment § CI/CD Recommendation](CLOUD_DEPLOYMENT.md#cicd-recommendation)):

1. `GET /health` returns healthy.
2. Log in with a known demo/test user for the target tenant.
3. Load the dashboard/search page and confirm data renders.
4. Run a quote workflow end to end (quote -> rate -> bind) in a
   non-production tenant.
5. Load the customer portal route if the deployment enables it, and confirm
   only customer-safe data is returned.
6. Confirm `schema_migrations` shows the expected latest version applied.

These steps are automatable: they map directly to existing Playwright E2E
coverage (`npm run test:e2e` / `npm run test:e2e:docker`) and the DB
integration suite (`npm run test:integration`). Running those suites against
the target environment's image/configuration before promoting is the
automated equivalent of this checklist; the manual steps above are the
fallback when running the full suite against a live environment isn't
practical.

## Observability And Alarms

LatticePolicy ships an optional observability stack
(`docker-compose.observability.yml`: Grafana Loki for log aggregation,
Promtail for log shipping, Grafana for dashboards/exploration — see
`observability/`). In cloud deployments, route container logs to the
provider's native logging service instead (CloudWatch Logs, Azure Monitor /
Log Analytics, Cloud Logging), as described per-provider in
[Cloud Deployment](CLOUD_DEPLOYMENT.md).

Configure alarms for, at minimum:

- API 5xx error rate.
- API/load-balancer target health (unhealthy host count > 0).
- Database CPU, storage, and connection count thresholds.
- Redis memory usage (if cache is enabled).
- Container/task restart count (crash-looping).
- Failed or stalled migration on deploy (a deploy step should fail loudly,
  not silently, if `runMigrations()` throws).

## Incident Response

1. **Detect** — alarm fires, or a smoke test / health check fails.
2. **Triage** — check `GET /health`, recent deploy history (is this
   correlated with a release?), and the observability logs/dashboards for
   error spikes.
3. **Contain** —
   - If correlated with a recent deploy and no risky migration shipped:
     redeploy the previous image tag immediately (see Rollback Guidance).
   - If correlated with a migration: do not attempt a live schema fix under
     pressure; prefer redeploying the previous application version only if
     it's still compatible with the now-migrated schema (expand/contract),
     otherwise proceed to a database restore.
   - If not deploy-correlated (infrastructure, dependency outage, capacity):
     scale/restart affected components, fail over to standby
     database/cache if the managed service supports it.
4. **Communicate** — record start time, affected tenants/scope, and current
   status; this project does not prescribe a specific status-page tool, but
   whatever channel carriers use for incident communication should be
   updated at triage and at resolution, at minimum.
5. **Resolve** — confirm the smoke test list passes again before declaring
   resolved.
6. **Review** — write a brief post-incident note (what happened, what fixed
   it, what should change). If the incident exposed a gap in this runbook,
   this document, `CLOUD_DEPLOYMENT.md`, or automated tests, open a follow-up
   issue and/or a `docs/tasks/` note per
   [AI-readable context requirements](AI_CONTRIBUTOR_PROCESS.md).

## RPO/RTO Assumptions And Validation Checklist

These are framework-level starting assumptions. Carriers should tighten them
to match their own regulatory and contractual obligations; document any
deviation in your own deployment runbook fork.

| Objective | Assumption | Depends on |
| --- | --- | --- |
| RPO (Recovery Point Objective) | As low as your managed Postgres provider's WAL-archiving/PITR granularity allows (commonly seconds-to-minutes) — **not** the daily backup interval, since PITR is enabled per the Backups section above. | Continuous WAL archiving being enabled, not just daily snapshots. |
| RTO (Recovery Time Objective) | Time to provision a restored database instance + redeploy known-good API/frontend images + pass smoke tests. This is provider- and data-volume-dependent and must be measured, not assumed — see Restore Testing above. | A tested, timed restore run. Do not publish an RTO number until you have measured one. |

Validation checklist before treating RPO/RTO numbers as real:

- [ ] PITR/WAL archiving is enabled and confirmed (not just daily backups).
- [ ] At least one full restore has been performed on a non-production copy
      and timed end to end.
- [ ] The restored copy passed the smoke test list above.
- [ ] The measured restore time is documented and compared against the
      target RTO.
- [ ] Alarms exist for backup job failures (a silently failing backup is
      worse than no backup, because it creates false confidence).

## Follow-Up Automation Needed

This runbook intentionally documents manual/operator-driven procedures where
no automation exists yet in this repository. The following should be tracked
as separate follow-up issues rather than left as permanently manual steps:

- An automated restore-test script (restore latest backup to a scratch
  instance, run a migration/smoke check, report pass/fail).
- A migration-lock or single-runner mechanism so `runMigrations()` is safe to
  invoke from multiple replicas without requiring operators to manually
  sequence a single migration step (currently a manual operational
  requirement, see Migration Execution above).
- Automated production smoke tests wired into the deployment workflow
  (`.github/workflows/deploy-aws-ecs.yml` / `deploy-azure-container-apps.yml`)
  so the smoke test list above runs automatically post-deploy instead of
  manually.
