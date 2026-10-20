# Task Note: PR #388 Node Compatibility

## Links

- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/388
- Parent coordination: #390 must use the same root engine string.
- Delivery track: quick - dependency compatibility fix; no product, data,
  tenancy, authentication, rating, migration or AI behavior changes.
- Delivery flow started for: fix PR #388 Node compatibility. This uses the
  documented quick-track option without a work package. Gate C remains human;
  no approval, PR merge or deployment is authorized.

## Summary

jsdom 30.1.3 requires newer Node patch/minor floors than the previous root
manifest advertised. Set both the canonical root manifest and root lock metadata
to `^22.22.2 || ^24.15.0 || >=26.0.0`, without changing dependency resolutions.
Update current setup/test guidance, leaving historical task notes unchanged.

## Important Files

- `package.json`, `package-lock.json`: identical root Node contract.
- `scripts/node-runtime.mjs`, `scripts/test.sh`: evaluate the root range before
  running locally; unsupported versions use the existing Docker fallback or
  fail with the required range when Docker is unavailable.
- `scripts/node-runtime.test.mjs`: boundary, CLI and engine consistency tests.
- `.github/workflows/ci.yml`: run engine contracts in the existing CI job.
- `README.md`, `docs/DEVELOPER_SETUP.md`, `docs/PROJECT_CONTEXT.md`,
  `docs/TEST_PLAN.md`: current contributor runtime instructions.

## Behavior Rules

- Node 22 starts at 22.22.2; Node 24 starts at 24.15.0; Node 26 and later
  stable releases are supported. Node 23, Node 25 and prereleases are not.
- The guard reads the root manifest, supporting only its stable-major caret
  ranges and open-ended floor; unsupported syntax fails closed.
- Preserve jsdom 30.1.3 and all existing test expectations/dependency versions.
- No live database, database-backed integration run or deployment is needed.

## Automated Tests

- Node built-in test runner: minimums, just-below floors, supported later
  versions, excluded majors, malformed/prerelease versions and CLI exit/message.
- Contract test compares the exact root/lock/jsdom engine strings, intentionally
  failing on future engine changes without pinning a jsdom patch version.
- Engine tests run in `test:local` and CI. Existing frontend suite exercises
  actual jsdom integration; workspace unit tests and typecheck check regressions.

## Validation

- Supplied Node executable inspected: v22.23.3.
- Clean initial fetch/merge of `origin/main`: already up to date.
- Final fetch confirms `origin/main` remains an ancestor of HEAD.
- `npm ci`: passed; 587 packages installed. Reports four high-severity audit
  advisories; no dependency resolution or audit-fix changes made.
- `npm ls jsdom`: root, frontend and Vitest resolve jsdom 30.1.3.
- `npm run test:node-runtime`: 28 passed, including after removing the patch pin.
- `npm run test:packages`: 3 files, 38 tests passed.
- `npm run test:frontend`: full suite, 58 files, 281 tests passed on jsdom 30.1.3.
- `npm run typecheck`, `npm run build:server`, `npm run build:frontend`: passed.
  The server build supplies its TypeScript check (no server typecheck script).
- Server unit suite with `DATABASE_URL` and `REDIS_URL` unset: initial run
  alongside the frontend suite had 670 passes and three 10-second timeouts in
  `document-storage.service.test.ts` (real Chromium PDF rendering). A second
  full run without the concurrent frontend suite passed all 85 files / 673
  tests. The attempted `--maxWorkers=1` argument to the root wrapper was ignored
  by npm, so the passing run used unchanged default Vitest settings. No timeout,
  expectation, test or production code was weakened. Timing sensitivity remains
  a follow-up; the passing run does not erase the original failure.
- `sh -n scripts/test.sh`, `git diff --check`: passed. Lockfile diff is one
  engine metadata line only, with no dependency churn.
- Independent read-only Codex reviewer (separate CLI session): no findings.
  Initial review used default Node 20 and could not pass the supported-runtime
  test. Final independent review used supplied Node 22.23.3, passed all 28 tests
  plus shell syntax/diff checks, and confirmed no patch-version assertion remains.

## Follow-Ups Or Risks

- Parent #390 must retain the exact engine string above to avoid cross-PR drift.
- Human Gate C and CI remain required. No approval or merge is performed here.
- Existing Chromium PDF timing sensitivity and install audit advisories are
  recorded above rather than hidden by this narrowly scoped compatibility fix.
