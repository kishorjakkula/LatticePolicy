# Local Deployment Record - WP-0003

This records the user's explicit local Docker request, not a merged staging
release, completed deployment stage, Gate C approval or production deployment.
The broader WP remains in development.

- Source: HEAD `25606a0` plus current uncommitted forms/rules/archive changes;
  application version 0.2.3. Not reproducible from HEAD alone until committed.
- Command: `docker compose up -d --build`.
- Environment: `DEPLOYMENT_ENV=local`; UI http://localhost:5173, API 3300.
- API image ID: `sha256:6ea2b70f56e873744f8bbb699afeafa1a709fdf8d78a54b5c7643f8a8e09a569`.
- UI image ID: `sha256:f8dbe1a8bb12e70683b0a82c910604fa33f494e8dd59ba8fd7b824b58a4ddb79`.
- Verification: API health reports status ok, db true, cache true; UI responds
  HTTP 200. Application containers were recreated; existing DB/cache volumes and
  carrier pilot stack were not removed or replaced.
- Schema/config: no new feature migration or application secrets required.
- Rollback: rebuild/redeploy a reviewed previous application revision/image,
  preserving DB/cache/document volumes. Do not use volume deletion or down
  migrations as an application rollback.

## Regression And Review

Full isolated Playwright run: 144 passed, 0 failed/flaky/skipped. Unit suites
passed. The default Docker DB runner lacks Chrome and failed 30/252 tests;
the full local-browser rerun against disposable PostgreSQL passed all 252 tests
in 38 files. See `docs/tasks/wp-0003-latest-implementation-review.md` for the
substantive review blockers. No regression test used the demo/pilot DB.

## Release Limits

Forms admin/rules and historical archive improvements are available locally.
Known P1 applicability/activation findings and the remaining independent module
scope prevent carrier-release readiness. No PR merge, Gate D sign-off, cloud
deployment or production release has been performed.
