# Tasks #360–#369: Pilot readiness

## Scope

User requested fixes for all readiness tasks, then selected a pre-customer
Docker pilot and authorized choosing a synthetic carrier and acceptance targets.
The pilot is Acme Mutual Pilot (`acme-pilot`), Homeowners/TX. Production customer
certification remains a separate gate. Issue links and original findings are in
`docs/FIRST_CUSTOMER_HANDOFF.md`.

## Changes

- #360/#361: policy form responses retain core controls from the pinned config,
  append additive fields once, preserve a null original screen, and fail closed
  for product/snapshot mismatch. New business still uses today's screen.
- #362: standalone backups pause all writers and resume prior services. Upgrades
  keep writers stopped from the backup recovery point through migration.
  Failed backup resumes the old release; incomplete document archives are
  rejected before restore changes data.
- #363–#369: reproducible pilot images, source/image manifest, synthetic standards,
  API and browser acceptance, bounded concurrency workload, restore and upgrade
  drill, local monitor/backup schedule, and redacted handoff tooling.
- Carrier API/UI ports default to loopback behind an explicitly configured proxy.

## Tests

- Product pinning PostgreSQL integration test covers core/additive and null
  original screens, pack changes, cache restart, and product mismatch.
- `scripts/carrier-stack.test.mjs` runs the actual shell script with a stateful
  Compose adapter, testing successful upgrade, failed migration/data retention,
  backup/document/stop failure, standalone backup, and incomplete restore pair.
- `e2e/pilot-product-pinning.spec.ts` changes a real mounted pack and endorses
  both old policy terms through the browser; validates button-triggered errors.
- `pilot:check`, `pilot:drill`, and `pilot:monitor` record Docker pilot evidence.

## Validation and limitations

Validation results will be recorded after the Docker acceptance run. Initial
pinning integration: 4 passed. Deployment recovery adapter: 7 passed.
No external customer data, approval, HTTPS endpoint, SLA, remote backup, or
external integration is claimed. Secrets and generated evidence stay in the
ignored `.pilot/` directory. Production issue completion must distinguish these
pilot results from target-infrastructure evidence.
