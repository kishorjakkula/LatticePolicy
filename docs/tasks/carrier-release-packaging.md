# Task Note: Carrier Release Packaging And Deployment Kit

## Links

- Issue: none yet (phase 2 of the carrier isolation and admin roles proposal)
- Pull request:

## Summary

Production runs one full stack per carrier, on a release the carrier chooses.
This change makes the published images usable for any carrier without a
rebuild, adds first-run setup for a carrier, and adds a kit that provisions,
backs up, upgrades, and rolls back a carrier stack.

## Important Files

- `frontend/public/runtime-config.js`,
  `frontend/docker-entrypoint.d/40-runtime-config.sh`, `frontend/src/config.ts`:
  the UI image takes its API URL and carrier at container start. Before this,
  the published image was built without an API URL and failed production
  validation at startup.
- `server/src/version.ts`, `GET /version` in `server/src/app.ts`,
  `getSchemaStatus()` in `server/src/db.ts`: running release, build commit,
  and schema level, including `schemaAhead`.
- `server/src/services/carrier-bootstrap.service.ts`,
  `server/src/bootstrapCarrier.ts`: tenant row, default roles, first carrier
  administrator.
- `deploy/carrier-stack/`: `docker-compose.yml`, `carrier.env.example`,
  `stack.sh`, `README.md`.
- `.github/workflows/publish-ghcr.yml`: passes `BUILD_COMMIT` to the API image.

## Behavior Rules

- One published image set must work for every carrier. Do not add a
  carrier-specific build step; add a container setting instead.
- `GET /version` stays unauthenticated and must not expose tenant or
  configuration detail.
- An older release running on a newer schema is allowed (documented
  application-only rollback) but must stay visible: a startup warning and
  `schemaAhead: true`.
- `bootstrapCarrier` validates all input before writing and never resets an
  existing administrator's password.
- `stack.sh upgrade` always backs up first and restores that backup if the
  upgrade fails. Do not add a path that upgrades without a backup.
- Backups contain encrypted customer data; they are only usable with the same
  `CUSTOMER_DATA_KEY` and `PII_LOOKUP_KEY`.

## Automated Tests

- Tests added or updated:
  - `frontend/src/__tests__/runtime-config.test.ts`
  - `server/src/__tests__/version.test.ts`
  - `server/src/__tests__/health.test.ts` (`GET /version`)
  - `server/src/__tests__/carrier-bootstrap.integration.test.ts`
- Test layer used: unit tests, PostgreSQL integration tests.
- `stack.sh` has no automated test. It was exercised by hand against locally
  built images: init, up, bootstrap, login, rejection of another tenant,
  backup, a successful upgrade, an upgrade with a failing migration
  (automatic rollback, data and documents intact), `rollback`,
  `rollback --keep-data`, restore of a named backup, and down/up with data
  retained.

## Validation

```bash
npm run typecheck
npm run test:frontend
npm run test:server
npm run test:integration
```

## Follow-Ups Or Risks

- `stack.sh` needs an automated end-to-end test in CI.
- The kit is a single-host Compose reference. Per-carrier templates for ECS,
  Container Apps, or Kubernetes are not included.
- No scheduled or off-host backups, and upgrades take downtime.
- The AWS and Azure deploy workflow changes (passing
  `VITE_CARRIER_TENANT_ID`) were not run.
- The compatibility check for a carrier's own product packs and custom fields
  against a target release belongs to the customisation boundary work.
