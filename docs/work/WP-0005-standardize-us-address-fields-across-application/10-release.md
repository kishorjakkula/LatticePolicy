# Release - WP-0005

Maintainer explicitly requested: "raise the pr and deploy the latest code in
docker". This authorizes a local branch preview, not merge, formal staging
acceptance or production. Gate C and the formal deployment stage remain pending.

- Revision: branch `latticepolicy/wp-0005-us-addresses`, application commit
  `a58291d13191b6bc1add4e663012799f826d17e7`, PR #396. Later test/documentation-only
  commits do not change the deployed application build.
- Migrations: none added by WP-0005. Existing startup migration behavior retained.
- New configuration: `ADDRESS_CHECK_PROVIDER`, `ADDRESS_CHECK_ALLOWED_TENANTS`.
  External checking stays disabled for this local deployment.
- Safety: preserve all database/cache/document volumes and carrier pilot stacks.
  PostgreSQL custom-format backup captured in local-only protected
  `tmp/wp-0005-deployment/before-deployment.dump`; never commit/upload it.
- Previous application images retained as `latticepolicy-server:before-wp-0005`
  and `latticepolicy-frontend:before-wp-0005` before rebuilding.
- Rollback: retag those images to the Compose application image tags and
  recreate only server/frontend with `--no-deps`. No volume deletion or database
  restoration is needed for this additive, migration-free change. Restore the
  backup only through a separately authorized data-recovery procedure.

## Release notes

Existing contact/customer/quote screens support complete postal fields and
multiple addresses per contact. Email/mobile remain contact-level. Each risk,
dwelling and vehicle garaging slot remains single-valued. ZIP+4/unit data is
preserved, with five-digit US rating projections. Optional Census range matching
is disabled by default and is not postal-deliverability certification.

## Deployments

| Environment | When | Revision | Health | By |
| --- | --- | --- | --- | --- |
| Local Docker branch preview | 2026-10-23 | a58291d | UI 5173 HTTP 200; API 3300 db/cache true | Maintainer-requested deployment |
| Formal staging | after Gate C | Pending | Pending | Pending |
| production | after Gate D | | | |

Automated tests use a disposable Docker stack, never demo/pilot databases.
Only read-only availability and asset/API checks target the preserved demo app.

## Verified Local Deployment

Both images built successfully; recreated only `policy-api` and `policy-ui`
with `--no-build --no-deps`. Existing database/cache containers (created two
weeks earlier), document volume and carrier pilot stack were not recreated.
Server image revision label and BUILD_COMMIT both identify a58291d. Images:
server `sha256:0c5d6872680f`, frontend `sha256:55b3a7a37dbf` (short IDs).
Actual running container images match the disposable verification images.

Provider and allowlist are empty in the running API: no external address check
is enabled. UI login returns 200 with no-cache/no-store; served assets include
the new contact communication controls. API health reports db/cache true.

Post-build tests: 14/14 passed in 33.4 seconds against the same exact images,
using a fresh isolated Docker project/database on 5174/3301, real tenant RLS,
cache and inline extraction. Frontend uses its supported runtime API setting.
Specs: contact-addresses, auth-route-access, quote-wizard. Test project/volume
removed after verification; no tests seeded or edited the demo/pilot database.
See 11-e2e-results.md. Prior full 165 browser tests remain recorded in 09.

The former host-process preview on 5175/3302 and its isolated dependency
containers were stopped to free resources. Use http://localhost:5173 now.
No production deployment, merge or Gate C/D approval was performed.
