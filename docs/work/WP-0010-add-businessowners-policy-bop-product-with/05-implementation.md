# Implementation — WP-0010

- Branch: `latticepolicy/wp-0010-businessowners` (from `main` at 235ee7c)
- Task note: `docs/tasks/businessowners-product-pack.md`

Codex built most of this package in the shared checkout, mixed with the
unrelated AI work. It was moved here file by file: only BOP files and the BOP
hunks of shared files, applied with a three-way merge over WP-0008. The package
was renumbered from WP-0009, which `main` already uses.

## Files changed

- Product pack: `products/businessowners/` (coverage, rates, README, original
  demo QUOTE/BINDER/DEC templates), `tenants/sample-carrier/field_meta.businessowners.json`,
  `contracts/quote.request.schema.json`, `packages/types/src/package-terms.ts`.
- Server:
  - `lib/product-package.ts`: package rules and derived `packageTerms`.
  - `rating.service.ts`, `rating-table.ts`, `product-rules.service.ts`: package checks before pricing and at every ruled transaction.
  - `uw.service.ts`: no fallback when the pack requires carrier underwriting rules.
  - `businessowners-authorization.service.ts`, `quote.service.ts`, `quote-bind.service.ts`, `quotes.routes.ts`: distribution checks with the authenticated actor.
  - `products.ts`, `intake/target-fields.ts`, `submission-intake.service.ts`: field metadata from the pack, structured premises address, nested intake keys.
  - `document-template-variables.ts`, `product-document-templates.service.ts`: BOP tokens and opt-in demo forms.
  - `businessowners-demo.service.ts`, `server/scripts/seed-businessowners-demo.ts`: opt-in demo setup.
- Frontend:
  - `QuoteWizard.tsx`, `coverageUtils.ts`, `riskDefaults.ts`: generic coverage defaults, required and included parts, building interest.
  - `CoveragePackageTerms.tsx`, `SubmissionPackageTerms.tsx`, `BusinessownersPolicyDetails.tsx`, `PolicyViewPage.tsx`, `SubmissionReviewPage.tsx`: show package terms.
- Fixtures: `examples/intake-samples/product-demo/` (BOP application, fixtures and expected results only).
- Docs: ADR 0004, `docs/API.md` (BOP error codes), `docs/PROJECT_CONTEXT.md`, task note.

### Added or fixed during the takeover

- `server/src/__tests__/businessowners-lifecycle.integration.test.ts` (new). It covers every transaction the pack advertises, through the domain services:
  - quote, bind and issue for owner and tenant;
  - endorse, with terms re-derived and package-breaking changes refused;
  - cancel and reinstate;
  - renew, rewrite and non-renew;
  - a second premises refused;
  - the authority referral for a servicer without a grant.

  Codex had advertised these transactions in `supportedTransactions` without tests, which REQ-1 does not allow.
- `customers.routes.ts` `toNullableNumber`: `null` or a blank became `0`. Saving any customer without coordinates stored latitude/longitude 0,0, and a blank ownership share became 0%. This is a pre-existing bug in `main`. Test: `customer-normalize.test.ts`.
- `businessowners-demo.service.ts`:
  - The comparison treated fixture keys left undefined as "must be absent", so every rerun reported a false conflict against the IDs main's customer normalizer now adds.
  - A rerun tried to issue the already-issued example again.
- `e2e/businessowners.spec.ts`. It had never run:
  - `import.meta` does not load under this Playwright setup;
  - the `**/api/**` mock also caught the dev server's `/src/api/*.ts` modules, which left a blank page;
  - at 390px the steps sit behind the compact "Step n of m" toggle.
- `QuoteWizard.tsx`: Codex's automatic coverage preselection ran for every non-built-in product, so carrier-pack products would have had every coverage preselected on load. It now runs only for packs that declare required or default coverages; other products keep the explicit "Apply Default Coverages" action. Test: `coverageDefaults.test.ts`.
- Unit fixtures adjusted for main: the bind authorization test now carries a current rating, because WP-0008 refuses stale ratings first. The document-history storage mock now stores the generic PDF it reports, because packet generation re-verifies every stored copy.

## Deviations from the design

- Renewal, rewrite and endorsement do not re-run the BOP distribution check (appointments and producer link). They rely on the existing authority grants and referral gates, which the lifecycle test shows apply to BOP. The reviewer should confirm this matches the servicing intent, or ask for the check at renewal.
- The demo authority grant covers new business only, so servicing a demo policy goes to an underwriter referral unless a grant is added. This is deliberate; it is not widened here.
- Intake fixtures are BOP-only. Codex's all-product intake bundle is a separate package and stays in the shared checkout.

## Checks run

- Server unit (`server/`, `npx vitest run`): 107 files, 1,155 tests passed.
- Frontend unit (`frontend/`, `npx vitest run`): 95 files, 624 tests passed.
- `npm run typecheck` (all workspaces) and `git diff --check`: clean.
- Database (`npm run test:integration`, disposable `lattice_policy_integration`, RLS enforced):
  - BOP demo (5 tests) and BOP lifecycle (8 tests) pass;
  - full suite on a fresh database: 47 files, 373 tests passed.
- Browser (`npx playwright test -c playwright.businessowners.config.ts`): 2 passed (1440px and 390px).

## Code review fixes (round 1)

- Major: the generic coverage editor saved `Number(value)` for limit and
  deductible choices, so personal auto's split limits (for example
  `100000/300000`) became `null` and were priced at the first table row. It now
  saves the offered option itself. Test: `coverageEditorValues.test.tsx`; it
  fails with the old code.
- `uw.service.ts`: the pinned-version lookup runs only for packs that declare
  package rules (BOP), so other products keep their fallback; duplicate import
  removed.
- `docs/API.md`: notes that terms copied with a changed limit are refused.
- Checks: typecheck clean; server unit 1,155 and frontend unit 625 passed; BOP
  lifecycle and authorization integration 46 passed; BOP browser spec 2 passed.
- Other minors are accepted as recorded in `07-code-review.md`.
