# Tasks #360–#369: Pilot readiness

## Scope

User requested fixes for all readiness tasks, then selected a pre-customer
Docker pilot and authorized choosing a synthetic carrier and acceptance targets.
The pilot is Acme Mutual Pilot (`acme-pilot`), Homeowners/TX. Production customer
certification remains a separate gate. Issue links and original findings are in
`docs/FIRST_CUSTOMER_HANDOFF.md`.

## Changes

- #360/#361: policy form responses retain core controls from the pinned config,
  render additive fields once through the configured screen, preserve a null original screen, and fail closed
  for product/snapshot mismatch. New business still uses today's screen.
  Endorsement rating calls the pinned policy preview directly, avoiding a
  preliminary new-business quote validated against today's required fields.
- #362: standalone backups pause all writers and resume prior services. Upgrades
  keep writers stopped from the backup recovery point through migration.
  Failed backup resumes the old release; incomplete document archives are
  rejected before restore changes data.
  Backup completion waits for a resumed API to become healthy before returning.
- #363–#369: reproducible pilot images, source/image manifest, synthetic standards,
  API and browser acceptance, bounded concurrency workload, restore and upgrade
  drill, local monitor/backup schedule, and redacted handoff tooling.
- Carrier API/UI ports default to loopback behind an explicitly configured proxy.
- Pilot validation also exposed missing step-one setup checks. The wizard now
  blocks an incomplete setup on Continue and associates field errors with the
  controls; the reusable `FieldError` and setup validator are covered by tests.

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

Local validation: 529 server, 211 frontend, 126 PostgreSQL integration,
133 Playwright regression, and ten deployment/pilot adapter tests passed.
Typecheck, architecture boundaries, dependency policy checks and Docker builds
passed. An initial browser cancellation timeout passed on a nine-test lifecycle
rerun and the full 133-test rerun. The bounded pilot workload completed 200
requests without errors; all ten generated documents returned readable content.
The three pilot browser scenarios passed. The local drill restored the database
and ten document hashes in 9.9 seconds, verified upgrade and both rollback modes,
retained an accepted transaction through failed migration, and verified worker
failure/recovery alerts. Host readiness checks after Docker restarts refresh
stale health connections without automatically retrying transaction writes.
Fresh SHA-matched pilot acceptance, browser and recovery evidence is required by
`pilot:handoff` and recorded under `.pilot/evidence/` and in the PR.
No external customer data, approval, HTTPS endpoint, SLA, remote backup, or
external integration is claimed. Secrets and generated evidence stay in the
ignored `.pilot/` directory. Production issue completion must distinguish these
pilot results from target-infrastructure evidence.
