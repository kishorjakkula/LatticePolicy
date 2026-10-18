# End-to-end results — WP-0001

- Environment and revision: local staging (Docker stack built from `main`), revision 4b4c068, 2026-10-18.
- Suites run and pass counts:
  - Browser smoke suite (`npx playwright test --grep @smoke`, 9 tests): 8 passed, 1 failed on the first run; the failed test passed on rerun (details below).
  - Delivery tooling on the `main` checkout: `npm run agents:sync -- --check` (in sync), `npm run delivery:check` (passed), `npm run knowledge:report` (10 current, 0 due), `npm run flow -- list` (WP-0001 listed).
- Evidence (screenshots, run links): the failure screenshot was reviewed during the run (Premium step showing homeowners endorsements on a personal auto quote) but was removed when the rerun cleared Playwright's `test-results/`; CI runs on PRs #382 and #383 (all checks green on #383).
- Defects:
  - **Pre-existing, intermittent, not caused by this change** (no application code changed in WP-0001): on the first smoke run, the personal auto quote's Premium step listed homeowners endorsements (END_WB, END_PPRC, END_ORD, END_ERC) instead of BI/PD, so `quote-wizard.spec.ts:20` failed waiting for "BI - Bodily Injury Liability". The personal auto product configuration is correct (BI, PD, COMP, COLL) and the test passed on rerun. Suspected cause: the wizard applying another product's coverage defaults when product configuration loads late or other specs run in parallel. Proposed as its own work package (major track: rating and coverages).
