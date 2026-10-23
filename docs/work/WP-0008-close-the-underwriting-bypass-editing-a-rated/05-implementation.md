# Implementation — WP-0008

- Branch: `latticepolicy/uw-rated-quote-guard` (separate worktree from main `d5d8b3e`; the
  main checkout belongs to another session).
- Task note: this file and the API entry in `docs/API.md` (draft and bind sections).

## Files changed

- New `server/src/lib/rating-fingerprint.ts`:
  - `ratingFingerprint(payload)` is sha256 over the normalized payload's canonical JSON, without billing fields (`billingMethod`, `paymentPlan`) and server-owned fields (`quoteId`, `productVersion`, `governanceLineage`, `productSnapshot`).
  - `storedRatingFingerprint(underwriting)`.
- `server/src/services/quote.service.ts`:
  - **Rating** stores `underwriting.ratedFingerprint` on both the insert and re-rate paths.
  - **`updateDraftQuote`:**
    - locks the row (`FOR UPDATE`);
    - validates the client status (only Draft, or Issued on a Converted/Issued quote; otherwise 400 `INVALID_STATUS`, including non-string values);
    - a client "Draft" never changes the stored status, so it can no longer reopen a bound quote, a defect older than this package;
    - resets status, underwriting and premium when the risk fingerprint changes on a Rated quote, compared against the current payload for ratings made before this package;
    - returns `ratingReset`.
- `server/src/routes/quotes.routes.ts`:
  - The draft route passes domain errors through, where it previously turned every error into a 500, and returns `ratingReset`.
  - The in-memory fallback refuses any client status but Draft.
- `server/src/services/quote-bind.service.ts`: `assertBindableRating` runs twice.
  - Right after loading the quote, before any referral or OFAC work.
  - Again under the existing #394 `FOR UPDATE` re-read, inside the policy transaction.
  - Either check returns 409 `QUOTE_RERATE_REQUIRED` for a missing rating, a missing premium or a fingerprint mismatch. Ratings with no fingerprint (made before this package) are accepted as they stand.
- `frontend/src/features/wizard/QuoteWizard.tsx`:
  - New `RerateNotice` on Premium ("Rate again") and on Forms & documents ("Go to Premium").
  - The `ratingNeedsRefresh` flag is set by the existing local invalidation, a draft save that returns `ratingReset`, or a bind 409.
  - New `serverErrorCode` helper.
- Tests:
  - new `server/src/__tests__/rated-quote-guard.integration.test.ts` (14 cases);
  - new `frontend/src/features/wizard/__tests__/rerate.test.tsx` (4);
  - `coverage-integrity.integration.test.ts` and `carrier-pack-lifecycle.integration.test.ts` now drop the fingerprint when they tamper with a stored quote, so bind still reaches the product-rules re-check those tests cover.
- `docs/API.md`: the draft and bind contract changes.

## Deviations from the design

- In-memory fallback (development mode only): only Draft is accepted, because that store holds only Draft and Rated quotes.
- The bind check runs twice (early and under lock) rather than once, so a stale quote never reaches referral creation.

## Checks run

Node 24.21, from the worktree.

- `npm run typecheck`: pass. `server npm run build` (the strict production build used by the Docker image): pass.
- **Server unit:** 977 passed.
- **Frontend:** 611 passed (including `rerate.test.tsx`).
- **New integration test, disposable PostgreSQL:** 14/14.
  - Mutation check: with the service changes set aside, 11 of the 14 fail. The 3 that still pass are the billing-only, legacy-bind and tenant cases, which need no fix.
- **Full server integration suite, host run on fresh PostgreSQL:** 312/316.
  - 2 failures were the tampering tests above; after the change they pass (5 files, 35/35, rerun).
  - 2 are environment-only (`ai-audit-phase3`, `contact-address`): they assert the `lattice_tenant_rls` role, which only the Docker runner provisions. They do not touch quotes or bind.
- **E2E:** not run locally. Free disk (3.4 GB) is below the safe level for the isolated stack build. The full Playwright suite runs in CI on the pull request, and must pass before Gate C.
