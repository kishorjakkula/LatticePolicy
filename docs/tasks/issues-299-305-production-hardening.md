# Issues 299-305: Production Hardening

## Scope

This batch closes the security, deployment, identity, API contract, disaster
recovery, and test-governance gaps identified in the repository audit.

## Implementation

- Sensitive SSN, FEIN, and date-of-birth lookup values use keyed HMAC-SHA256.
  Existing encrypted values can be re-keyed transactionally with
  `npm run rehash:pii --workspace=server` after both encryption and lookup keys
  are configured.
- Database migrations use a PostgreSQL advisory lock, and production migration
  execution is available as a dedicated command.
- OIDC login supports a popup callback that transfers credentials only to the
  configured frontend origin and does not place tokens in URLs.
- AWS and Azure deployments require API and frontend smoke-test endpoints.
- OpenAPI generation rejects duplicate routes and stale operation overrides.
- Quarterly and manual recovery drills run a provider-managed restore command,
  validate the isolated database, and retain machine-readable evidence.
- CI enforces measured frontend and server coverage floors.

## Operations

Set `PII_LOOKUP_KEY` to a unique secret of at least 32 characters. During the
first rollout, deploy the key and run the PII re-hash command before serving
traffic from code that performs keyed lookups.

Configure the `disaster-recovery` GitHub environment with
`RESTORE_COMMAND`, `RESTORE_DATABASE_URL`, and `PRODUCTION_DATABASE_URL`.
The restore command must restore the selected backup into the isolated URL;
the validator refuses to run against the production URL. The adapter must
also write `restore-metadata.json` containing the selected backup or PITR
timestamp as an ISO `restorePoint`; the evidence reports its age and the
measured validation duration.

## Verification

- Frontend and server unit tests
- Frontend and server coverage runs
- TypeScript typecheck and production builds
- Docker-backed migration/integration suite
