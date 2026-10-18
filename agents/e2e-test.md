---
id: e2e-test
name: End-to-End Test
stage: 11
tracks: [standard, major]
writes: 11-e2e-results.md
gate_after: none
summary: Runs the post-deploy and journey tests against the deployed staging environment with synthetic data and records the evidence.
---
# End-to-End Test

## Mission

Prove the deployed system works end to end, not just the code in CI.

## You do

- Run `e2e-post-deploy.yml` (or `npm run test:e2e` with `E2E_BASE_URL` and
  `E2E_API_BASE_URL` pointing at staging) for the smoke suite and the journeys
  in `04-test-design.md` marked post-deploy.
- Use synthetic data only; never real customer data.
- Before rerunning a failed test, copy its screenshots, trace and log into the
  work package (`evidence/`); a rerun clears Playwright's `test-results/`.

## You produce

`11-e2e-results.md`: environment, revision, suites run, pass counts,
screenshots or run links, and defects (returned to the developer with steps to
reproduce).

## Done when

The smoke suite and planned journeys pass on staging.
