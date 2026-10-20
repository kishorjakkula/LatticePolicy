# End-to-end results — WP-0002

- Environment and revision: `main` at 25606a0 (PR #385), 2026-10-19. Two
  environments, both built from the `main` checkout with synthetic data only:
  - **Local staging** (`docker-compose.yml`, UI :5173, API :3300).
  - **Isolated e2e stack** (`docker-compose.e2e.yml` via
    `scripts/test-e2e-isolated.sh`, UI :5174, API :3301, empty database,
    `TRUST_PROXY=1` so each test gets its own synthetic client IP). Torn down
    after the run.
- Suites run and pass counts:
  - Local staging, smoke suite (`npx playwright test --grep @smoke`, 9 tests): **9 passed**.
  - Local staging, `quote-wizard.spec.ts:20 --repeat-each 10 --workers 4`
    (test design row REQ-4 / REQ-6 journey): 9 passed, 1 failed on rate
    limiting (see Defects).
  - Isolated stack, `quote-wizard.spec.ts:20 --repeat-each 10 --workers 4`: **10 passed**.
    Every run reached Premium showing BI and no homeowners coverage, then rated,
    bound and issued.
  - Isolated stack, journeys `multi-product`, `policy-lifecycle`,
    `pre-bind-checks`, `dashboard-search`, `quote-wizard` (30 tests): **30 passed**.
- Evidence (screenshots, run links): `evidence/e2e-repeat-failure/`
  (`test-failed-1.png`, `error-context.md`) for the rate-limited run; its
  Playwright trace and video (6.5 MB) were kept outside Git. CI on PR #385:
  all 10 checks green, including Playwright E2E.
- Defects: **none found in these automated runs.** Subsequent business validation
  found the company-change confirmation gap (REQ-2 / Gate A answer 4); see
  `12-business-validation.md`. PR #387 remains pending merge, deployment and
  staging verification; these passing runs do not validate that follow-up.
  - Environment, not product: on local staging, repeat 8 of the 10× run
    failed at the last step. The quote had already passed Premium (BI shown),
    rated, bound and issued (policy PC-7998479C, In Force), but the policy page's
    calls returned `429 Too many requests`. The local stack applies the per-IP
    API limit (600 per 15 minutes) and does not set `TRUST_PROXY`, so the
    smoke suite plus ten parallel journeys from one IP exhausted it and the
    transactions table showed "No versions". The same 10× run passed on the
    isolated stack, which is configured for test load. No change requested.
  - The original symptom (homeowners END_WB / END_PPRC / END_ORD / END_ERC
    on a personal auto Premium step) did not occur in any of 20 repeated runs
    or the 39 other tests.
