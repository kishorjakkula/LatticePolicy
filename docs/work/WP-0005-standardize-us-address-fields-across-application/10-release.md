# Release - WP-0005

Maintainer explicitly requested: "raise the pr and deploy the latest code in
docker". This authorizes a local branch preview, not merge, formal staging
acceptance or production. Gate C and the formal deployment stage remain pending.

- Revision: branch `latticepolicy/wp-0005-us-addresses`; deployment revision to
  be recorded after the image build and verification.
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
| Local branch preview | Requested; build/verification pending | Pending | Pending | Maintainer request |
| Formal staging | after Gate C | Pending | Pending | Pending |
| production | after Gate D | | | |

Automated tests use a disposable Docker stack, never demo/pilot databases.
Only read-only availability and asset/API checks target the preserved demo app.
