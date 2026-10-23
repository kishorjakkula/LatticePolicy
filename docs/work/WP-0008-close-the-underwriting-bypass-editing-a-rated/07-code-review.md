# Code review — WP-0008

> Code reviewer (separate session from the developer). Fill every placeholder below (the flow will not complete the stage while any remain).

- Reviewer session / tool: Claude Code, independent code-reviewer session (Opus 5.5), separate from the developer session
- Diff reviewed: `git diff d5d8b3e...39d6cbf` (PR #398, branch `latticepolicy/uw-rated-quote-guard`)

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Major | server/src/lib/rating-fingerprint.ts:19; server/src/services/quote.service.ts:514 | `productSnapshot`, `productVersion` and `governanceLineage` are excluded from the fingerprint, but a draft save takes them straight from the client (the whole payload is replaced). `rate()` prices from `productSnapshot`, and bind uses it for the product rules, the validation gate and the policy's pin for the term. | A client rates a quote, then saves it with `productSnapshot` set to another snapshot of the same product and tenant: the rating stays, and bind runs that version's rules and pins the policy to it. Separately, every wizard autosave after rating removes all three keys, because the wizard state never holds them. The bound policy then has no product pin and no governance lineage. | Returned. Fix: in `updateDraftQuote`, copy these keys from `row.payload` and ignore the client's values (as `carryProductPin` does), and add a test for both cases. |
| Major | server/src/services/quote.service.ts:505-506 | The reset runs only when `row.status === 'Rated'`. Bind does not check the status, and it accepts a rating with no fingerprint. | A quote rated before release is moved to `Expired` by the stale-quote job (which keeps underwriting and premium) or to Draft by an old client PATCH. Its risk is then changed through PATCH /draft, with no reset, and it binds at the old Eligible rating. The original bypass stays open for these rows. | Returned. Fix: reset whenever `row.underwriting` is set and the status is not Converted or Issued. Add an integration test with a legacy Expired row. |
| Major | frontend/src/features/wizard/QuoteWizard.tsx:3076; server/src/services/quote.service.ts:500 | Regression: in policy-transaction modes (endorse, renew, rewrite, cancel, reinstate) the wizard sends `status: 'Issued'` on a quote that is Rated or Draft, never Converted. The server now answers 400 and the wizard's catch hides it. | After every wizard policy transaction, the quote stays Rated or Draft in the quote list and status history instead of Issued, and the final payload is not saved. No E2E test checks this, so CI stays green. | Returned. Fix: record Issued on the server when the transaction is applied, or allow Issued for a quote linked to that policy. Add a test. |
| Minor | server/src/services/quote.service.ts:398; server/src/routes/quotes.routes.ts:194 | `POST /quotes/draft` (and the in-memory path) still writes any client status, so a quote can be created as "Rated", "Converted" and so on. This goes against REQ-2's rule that lifecycle statuses are server-owned. Bind still refuses, because there is no underwriting or premium. | The quote list shows fake lifecycle statuses. A quote created as "Converted" can then be set to "Issued" through PATCH. | Returned (small fix: accept only Draft). |
| Minor | server/src/routes/quotes.routes.ts:271-300, 347 | In-memory fallback (development only): PATCH /draft keeps `uw` and `premium` when the payload changes, and the in-memory bind has no fingerprint check. | In development without a database, the original bypass still works. | Accepted if the in-memory mode cannot run in production; otherwise returned. |
| Minor | frontend/src/features/wizard/QuoteWizard.tsx:1238-1245 | `ratingNeedsRefresh` is not cleared when the wizard loads or resets to another quote. | After editing a rated quote, the user opens another unrated quote in the same wizard instance, and its Premium step wrongly shows "Your changes need a new rating". | Returned (clear the flag next to `ratedPayloadSnapshot.current = ''`). |
| Minor | rated-quote-guard.integration.test.ts; rerate.test.tsx | Test gaps against 04-test-design:<br>- No HTTP-level test of PATCH /draft: AppError pass-through, the 400/404 body shape and `ratingReset` in the response.<br>- No concurrent save and bind test.<br>- No fingerprint-stability test that uses the real `buildWizardQuotePayload` output.<br>- The REQ-2 case ("unrated draft, status Rated, then bind refused") does not bind.<br>- The wizard tests cover only `RerateNotice` and `serverErrorCode`. Nothing checks that the flag is set on `ratingReset` or on a 409, cleared on rate, or that Bind is disabled. | Regressions in route error mapping or in the wizard's state handling would go unnoticed. | Returned (add at least the HTTP and wizard-state tests). |
| Minor | 02-design.md / 05-implementation.md | The design says a rating with no fingerprint is "accepted once and recorded" at bind. The code records nothing. This is harmless, because bind converts the quote, but the documents disagree. | None at runtime. | Returned (update the documents). |
| Info | server/src/services/quote-bind.service.ts:393 | Not part of this diff. `checkQuoteExpiry(quote)` is given `{payload, uw, premium}` with no expiry date, so it never refuses. Bind also does not refuse status `Expired`. | Expired quotes can be bound. | Separate work item suggested. |

## Code review — 2026-10-23

### What I checked

- **Completeness:** I checked every writer of `quotes.payload`, `status` and `underwriting`:
  - `createOrRateQuote` stores a fingerprint on both the insert and the update path.
  - `updateDraftQuote` (patched).
  - `copyQuote` and `insertDraftQuote` (submission and AI intake) create Draft quotes with no underwriting.
  - The import path calls rate and then bind.
  - The stale-quote job changes only the status; see the second Major finding.
  - The bind update and the in-memory store.

  The only bind entry points are `POST /quotes/:id/bind` and `data-import`, and both use `bindQuote`. The in-memory bind is development only.
- **Fingerprint false positives:** I ran the rate preparation outside the database (`normalizeQuotePayload`, `pinToCurrentProduct`, `rate`, `evaluateUW`):
  - The only key the server adds is `productSnapshot`; governance adds `productVersion` and `governanceLineage` when a database is present.
  - Nested data is not changed.
  - The wizard-shaped payload produces the same fingerprint.
  - Dates are normalized the same way on both paths; `canonicalProposal` drops undefined values and sorts keys.

  CI Playwright E2E passed on the PR, which covers wizard bind after autosaves.
- **Fingerprint false negatives:**
  - The billing fields are not read by rating, UW rules or fees for the PA path. The wizard's local snapshot excludes them as well (WP-0004).
  - `productSnapshot` is read by `rate()` and bind; see the first Major finding.
- **Legacy:** `underwriting` is written only by the server; no API lets a client remove `ratedFingerprint`. The risk is the status gate in the second Major finding.
- **Concurrency:**
  - A draft save takes only the quote row lock, in one transaction.
  - Bind's final transaction locks the quote with `FOR UPDATE` and then the referral row.
  - The #394 advisory lock is taken in a separate, earlier transaction (`resolveReferralGateForActor`).

  The locks cannot form a cycle. If a draft save happens between bind's first read and its lock, bind fails with 409 (the rating was reset) or `QUOTE_CHANGED` (billing-only change).
- **Status rules:**
  - Issued is accepted only on Converted or Issued quotes.
  - A client "Draft" never changes the status.
  - A non-string status is refused by Zod (400) before the service runs.
  - The draft route now passes `AppError` through, and app.ts returns `{code, message}`, which `serverErrorCode` parses from the client's `failed 409: {...}` message.
  - The policy-transaction audit regression is the third Major finding.
- **Wizard:**
  - The notice shows on steps 7 and 8.
  - The flag is cleared after a successful rate.
  - Bind is disabled with "Rate premium first" while `quoteResp` is null.
- **Tests:**
  - All 14 integration cases are meaningful. The mutation check claimed in 05 is plausible: the billing, legacy and tenant cases need no fix.
  - The two adjusted tampering tests remain valid: they now exercise the product-rules re-check for ratings made before this package.

### Checks run (worktree, Node 24.21)

- `frontend: npx vitest run src/features/wizard/__tests__/rerate.test.tsx` passed 4/4.
- `server: npx tsc --noEmit -p .` is clean.
- `server: npx vitest run quote` passed 37/37 in 5 files.
- A scratch probe of the fingerprint's stability and of a `productSnapshot` swap confirmed that the swap keeps the fingerprint.
- I could not run the integration suite locally, because no PostgreSQL is available and disk space is low. `gh pr checks 398`: DB Integration Tests, Playwright E2E, Build/Test/Typecheck and CodeQL pass; pilot is pending.

### Gate C

**Blocked.** Three Major findings are open and returned to the developer. No Blockers.
