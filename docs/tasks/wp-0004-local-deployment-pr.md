# WP-0004: Local Docker Deployment And PR Preparation

## Request

On 2026-10-21 the maintainer requested deploying the latest code to local
Docker, running regression testing and opening a PR if checks pass. This is
an explicitly requested local development preview, not approval of Gate C,
formal merged-main staging or production deployment.

## Integration Decisions

- Preserve existing local PostgreSQL, Redis and document volumes. Do not run
  mutation tests against the demo or carrier pilot. Browser regression uses
  the isolated Docker stack; database integration uses a fresh disposable DB.
- The local database already recorded `067_agent_studio.sql` and
  `068_agent_runs_promotion.sql`. Move referral evidence to migration **069**
  instead of silently skipping it. No existing migration records or Agent
  Studio tables are changed. `/version` now reports applied/release 69 and
  `schemaAhead: false`; legacy referral evidence stays null.
- Integrate current `origin/main` (`e218c94`), preserving phase-one fixes and
  #387's intent: no silent loss of entered quote data. In the newer approved
  product-first flow, only compatible companies are offered and switching
  among them preserves product/state/answers/risks/limits/common fields while
  invalidating rated output. Actual product changes still require confirmation
  before clearing product-specific data. A defensive incompatible-company
  fallback also retains its confirmation.
- Preserve the main form-metadata document title regression and the newer
  responsive pager/dialog/theme behavior. Keep unrelated local research and
  generated files out of the commit/PR.

## Verification

Post-main-merge frontend: 88 files / 594 passed. Server: 93 files / 942 passed.
The first migration-069 full PostgreSQL run passed 298 tests; the new legacy
upgrade regression passed separately. Root typecheck, server build, agent-file
sync, delivery checks and audit policy passed. Audit retains existing approved
Puppeteer/extract-zip advisories. Private processor 19 passed / 1 opt-in native
OCR skipped; signer 3, learning 20 and shared rules 221 passed. The unbounded
root frontend invocation was stopped and replaced by the bounded passing run.

Rawls independently reviewed the merge integration and migration numbering:
no actionable findings; 48 focused tests passed. Earlier proposal-bound
review and fixes remain in `07-code-review.md`.

### Infrastructure Interruption

At 18:45 UTC, Docker Desktop reported `no space left on device` while writing
its VM log. This stopped the test database and browser services;
the final parallel full runs ended in connection errors, not valid green
regression evidence. The local app had already been rebuilt and checked
healthy at revision `0a06f2a` with applied/release schema 69. Docker recovery
completed with a forced Desktop stop/start (normal restart was unresponsive),
followed by removal of about 3.97 GB of unused build cache only. Application
volumes were not removed. The demo and pilot health endpoints both recovered.
Free host space initially increased to about 6.9 GiB. Fresh database/browser
reruns then ran sequentially; their final results are recorded below.

### Final Verified Reruns

- Frontend: **594 passed** (88 files); backend: **942 passed** (93 files).
- Fresh PostgreSQL integration: **299 passed** (42 files), including the
  migration-069 upgrade and tenant RLS regressions.
- Fresh isolated Chromium: **162 passed**, one worker, after the database run
  completed. Reused the already-built final application images with
  `docker compose -f docker-compose.e2e.yml up -d --no-build`; API/UI readiness
  checked before Playwright. No demo/pilot mutation tests were run.
- Unused build-cache cleanup reclaimed approximately **7.28 GB total** across
  both passes. Host free space recovered to about 8 GiB; application volumes
  and existing deployed image data were preserved. More host disk headroom is
  advisable before future large concurrent builds.
- Local preview: `http://localhost:5173`, API health `http://localhost:3300/health`.
  Version 0.2.3, applied/release schema 69, no schema-ahead warning; database and
  cache healthy. Pilot health also recovered following the Docker restart.
- Runtime revision: `0a06f2a` (subsequent evidence-only commits do not change it).
  Local API image: `sha256:597898516f886f2c194a49459aef73fdb71d4b32322625d4c3425ecbf5877b72`.
  Local UI image: `sha256:5280cf24e5c1a88ea51be3f026fdc20370b28a783bc0d4b4a87988a1b7352d8b`.

Synthetic desktop/mobile referral screenshots are retained under the work
package's `evidence/local-regression/` directory. The final evidence supersedes
the interrupted runs, without hiding their infrastructure cause. PR creation
is authorized by the original request; Gate C approval/merge, formal merged-main
staging and business sign-off remain human-controlled follow-ups.

## PR #394 CI Environment Correction

Remote DB integration reported 298 passed / 1 failed because the new AI audit
isolation regression requires `TENANT_RLS_ENFORCED=true`, but the CI job did
not set it. The disposable Docker runner had the same omission. Both runners
now explicitly enable enforcement; no isolation assertion, RLS policy or
application authorization is weakened. Direct workspace test commands must
also supply the flag (see `docs/TEST_PLAN.md`).

Verification: all **299 integration tests / 42 files passed** on a fresh
PostgreSQL 15 container with both flags enabled (90.23 seconds, Node 22).
The previously failing AI audit regression is unchanged and passes. Root
typecheck, 27 delivery contract tests, generated-agent sync, shell syntax and
parsed-YAML checks passed. Independent review found no actionable issues.
Only the temporary test database container is removed after verification;
the local app and pilot databases are not used. GitHub CI must rerun on the
new commit; local results do not imply a remote pass or human merge approval.
