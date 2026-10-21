# PR #387: Company-change preservation and reset regression tests

## Links And Scope

- PR: https://github.com/kishorjakkula/LatticePolicy/pull/387
- Work package: WP-0002, REQ-2 and REQ-4; follow-up to its approved
  confirm-before-clear design and business-validation company-change finding.
- Delivery track: quick - test-only strengthening of the existing implementation.
  No gate approval, PR merge, deployment, or production behavior change.

## Important Files

- `frontend/src/features/wizard/__tests__/companyChange.test.tsx`: renders the
  real `QuoteWizard` in a router, loading a synthetic saved rated quote through
  the API boundary. Exercises real selectors, confirmation, draft saving,
  navigation, and generated-document rendering. No mocked React state, reset
  helper, wizard child components, or confirmation callbacks.

## Behavior Rules And Coverage

- Keep and Escape each preserve the complete saved payload, including entered
  qualification answers, VIN/risk details, nondefault coverage limit, primary,
  secondary and additional insureds, and common policy data. Both preserve the
  existing rating worksheet and quote summary.
- Confirm clears the previous product, state, offering, qualification answers,
  risks and coverages. Applicant/insured identity, agency, commission, term,
  prior insurance, billing, mailing address and additional interests survive.
- Reference-data effects may select the sole available country/product and
  resolve a destination company configuration. Assertions accommodate those
  existing effects without permitting old product data to survive.
- A separate same-product destination case proves rating/document invalidation
  without invoking the manual product-change handler (which would independently
  invalidate them and conceal a company-reset regression). It checks both
  generated documents disappear and Bind remains disabled until re-rating.
- Each case first verifies the rated documents exist; preservation cases also
  establish nonempty qualification, risk and coverage data before comparing
  saved payloads. This prevents empty fixtures from producing false positives.

## Validation

Executed in the managed isolated checkout with Node 22 and dependencies from
the root lockfile after a non-destructive merge of `origin/main` (`0dac761`).
All API/reference responses are synthetic boundary mocks: no server, browser
ports, demo/pilot database, or shared application state is used.

- Targeted component suite: 4/4 passed.
- `npm run typecheck`: passed.
- `npm run test --workspace=frontend -- --maxWorkers=1`: 286/286 tests passed
  across 59 files. One worker limits contention with other isolated test runs.
- Temporary removal of company rating/document invalidation makes the
  same-product case fail on stale generated output; production source restored.
- Temporary retention of old coverages makes the confirmation case fail on the
  saved nonempty coverage array; production source restored.
- `npm audit --omit=dev --audit-level=high`: reports four existing high-severity
  Puppeteer/extract-zip dependency findings, outside this test-only change.

## Follow-Ups Or Risks

These are full-wizard component regressions, not fresh live end-to-end evidence.
Existing Playwright coverage is unchanged. The PR still requires independent
review/CI and human Gate C approval. No approval is asserted by this task note.
