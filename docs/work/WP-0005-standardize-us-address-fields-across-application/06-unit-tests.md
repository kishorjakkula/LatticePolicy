# Unit And Integration Tests - WP-0005

All fixtures are synthetic. Provider calls are mocked; real PostgreSQL is used
for persistence and the customer-service permission path, not a mocked save.

## Added Or Updated Tests

- `ContactAddresses.test.tsx`: independent communication, collections, primary
  removal, empty lists, read-only, non-US values, postal/rating ZIP and stale check.
- `companyChange.test.tsx`: normalized collections, primary email update/clear,
  and delayed read-only contact responses preserving current edits.
- `address-check.test.ts`: provider/tenant/pinned gating, strict minimal envelope,
  unsupported input, bounded/malformed results, minimal outbound data, preserved
  units and ZIP+4, fetch/body deadlines and sanitized failures.
- `address-routes.test.ts`: permissions, portal denial, no-store, URL alias
  idempotency bypass, tenant/principal rate-bucket isolation and blocked overflow.
- `address-parser.test.ts`: six permanent real-app parser checks for malformed
  JSON and the 4 KB limit across canonical, trailing-slash and uppercase paths;
  responses contain neither the synthetic private marker nor an error stack.
- `contact-address.integration.test.ts`: actual restricted RLS role, customer
  collection save/load, contact-only address PATCH preserving encrypted DOB/hash,
  BOTH -> INDIVIDUAL/COMPANY denied without writes, quote-to-policy snapshots.
- Existing interest, notification and document-token tests cover complete
  projections and the current contact email as notification recipient.

## Results

Local Node 22; exact-name fresh disposable PostgreSQL 15 database
`lattice_policy_integration`, `LATTICE_DISPOSABLE_TEST_DATABASE=true`,
`TENANT_RLS_ENFORCED=true`. No pilot/demo database used.

| Command | Result |
| --- | --- |
| `npm run test:packages` | 221 passed, 4 files |
| `npm run test --workspace=frontend -- --maxWorkers=2` | 604 passed, 89 files |
| `npm run test --workspace=server -- --maxWorkers=1` | Final 977 passed, 96 files, including the six permanent parser regressions |
| `npm run test:integration --workspace=server` | 302 passed, 43 files |
| `npm run typecheck` | Passed |
| `npm run build` | Frontend and server passed |
| `npm run check:architecture` | 3 tests passed; no cycles/forbidden imports |
| `npm run security:audit` | Passed project policy after targeted ip-address 10.7.4 lockfile patch; existing accepted extract-zip/Puppeteer advisories remain |
| Focused `address-parser.test.ts` | 6 passed; independently source-reviewed in 07a |

An earlier integration attempt named the new database with a `_final` suffix:
42 files passed but the form-attachment fixture correctly refused that name
(58 skipped). It was rerun from a newly created database with the exact required
name, without weakening the fixture guard; all 302 passed.

## Requirement Coverage

| Requirement | Evidence |
| --- | --- |
| REQ-1 | ContactAddresses labels; browser existing-screen fields and layout |
| REQ-2 | postal/rating ZIP, non-US component cases; browser ZIP+4 draft payload |
| REQ-3 | PostgreSQL customer/snapshot test; interest/document projection tests |
| REQ-4 | address-check match-count/malformed/unsupported cases |
| REQ-5 | stale-result component case; original units preserved in service test |
| REQ-6 | disabled/allowlisted/pinned, strict envelope, minimized outbound, no replay |
| REQ-7 | rejected fetch, body/fetch timeout and unsupported tests |
| REQ-8 | restricted RLS assertion, contact-only API role, forbidden identity/type changes |
| REQ-9 | Full suites above plus browser/a11y results in 09 |
| REQ-10 | collection/primary component cases and real customer/snapshot/browser persistence |
| REQ-11 | separate communication component/API/browser cases; updated/cleared recipient |

Planned manual carrier UAT, every non-US postal convention and provider
accuracy/fitness are not claimed as automated proof. Live service smoke used
only a public address; it does not certify postal delivery or carrier privacy.
