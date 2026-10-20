# Unit And Integration Tests - WP-0003

Scope: forms/rules/admin and exact-transaction archive slice only. This evidence
does not complete the entire work package's unit-test stage.

## Results

Verified locally using Node 22:

| Command / suite | Passing |
| --- | --- |
| `npm run test:packages` | 209 tests, 4 files |
| `npm run test:frontend` | 354 tests, 62 files |
| `npm run test:server` | 723 tests, 88 files |
| Form attachment PostgreSQL integration | 71 tests, 1 file |
| Policy lifecycle + document artifact storage integration | 14 tests, 2 files |
| `npm run typecheck` | Passed |
| Application build / isolated Docker image builds | Passed |

The 71-case suite also passed in its standalone Docker-owning mode and in the
explicit disposable-database mode, including a run without Docker in PATH.
Other integration files and the entire end-to-end suite were not run as part of
these counts. Browser results are tracked separately.

## Coverage Added

- Expression grammar, unsafe paths/prototypes/getters, structural limits,
  custom carrier data, suppression precedence, missing values, aliases and
  deterministic transaction-effective dates.
- Full coverage limit/deductible selection, Money premium normalization,
  named-insured objects, business transaction versus stage, and new-term dates.
- Real API roles/tenants, rule create/update/delete, audits/rollback, legacy
  compatibility, clone behavior, invalid priority/expression types and
  publication/edit lock ordering observed through PostgreSQL blockers.
- Preview/generation decisions and immutable rule/stage provenance.
- Metadata-only catalog summaries and removal of all-form detail hydration.
- Admin rule/scenario controls, stale async/result handling, save-and-continue
  failures, refresh, unsupported uploads and read-only mutation controls.
- Exact policy/version/transaction archives, unavailable/corrupt originals,
  worksheet SQL version ownership and no implicit download-time rendering.
- Real Issue generation with individual UW decision, transaction premium,
  policy status/term conditions and a composite condition; persisted snapshots
  identify the actual Issue stage. Admin source form identity is stored in
  `metadata.sourceFormId`; SQL `form_id` is reserved for catalog FK identity.

## Requirement Coverage And Limits

REQ-5/7/8/11 receive scoped configuration, archive, isolation and automated
regression evidence. This is not full acceptance of any enterprise requirement.
Native Excel/fillable-PDF/conversion/assembly, coordinator failure injection,
load/soak, restore, package promotion and carrier UAT remain unverified and
require their corresponding implementation and tests.

Subsequent full regression: all **252 integration tests in 38 files passed**
using the installed local browser and a fresh disposable PostgreSQL database.
The default Docker runner separately failed 30 tests because its Node image
lacks Chrome; that infrastructure issue remains open in the latest review note.

Existing negative-path tests emit expected warning/error logs; the PostgreSQL
client also emits a concurrent-query deprecation warning. Neither is recorded
as a failing test or proof of performance readiness. No demo/pilot DB was used.
