# Code review — WP-0008

> Code reviewer (separate session from the developer). Fill every placeholder below (the flow will not complete the stage while any remain).

- Reviewer session / tool: Claude Code, independent code-reviewer session (Opus 5.5), separate from the developer session
- Diff reviewed: `git diff d5d8b3e...39d6cbf` (PR #398, branch `latticepolicy/uw-rated-quote-guard`)

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Major (resolved) | server/src/lib/rating-fingerprint.ts:19; server/src/services/quote.service.ts:514 | `productSnapshot`, `productVersion` and `governanceLineage` are excluded from the fingerprint, but a draft save takes them straight from the client (the whole payload is replaced). `rate()` prices from `productSnapshot`, and bind uses it for the product rules, the validation gate and the policy's pin for the term. | A client rates a quote, then saves it with `productSnapshot` set to another snapshot of the same product and tenant: the rating stays, and bind runs that version's rules and pins the policy to it. Separately, every wizard autosave after rating removes all three keys, because the wizard state never holds them. The bound policy then has no product pin and no governance lineage. | Resolved in 4056124, verified in the re-check (2026-10-23). Originally returned. Fix: in `updateDraftQuote`, copy these keys from `row.payload` and ignore the client's values (as `carryProductPin` does), and add a test for both cases. |
| Major (resolved) | server/src/services/quote.service.ts:505-506 | The reset runs only when `row.status === 'Rated'`. Bind does not check the status, and it accepts a rating with no fingerprint. | A quote rated before release is moved to `Expired` by the stale-quote job (which keeps underwriting and premium) or to Draft by an old client PATCH. Its risk is then changed through PATCH /draft, with no reset, and it binds at the old Eligible rating. The original bypass stays open for these rows. | Resolved in 4056124, verified in the re-check (2026-10-23). Originally returned. Fix: reset whenever `row.underwriting` is set and the status is not Converted or Issued. Add an integration test with a legacy Expired row. |
| Major (resolved) | frontend/src/features/wizard/QuoteWizard.tsx:3076; server/src/services/quote.service.ts:500 | Regression: in policy-transaction modes (endorse, renew, rewrite, cancel, reinstate) the wizard sends `status: 'Issued'` on a quote that is Rated or Draft, never Converted. The server now answers 400 and the wizard's catch hides it. | After every wizard policy transaction, the quote stays Rated or Draft in the quote list and status history instead of Issued, and the final payload is not saved. No E2E test checks this, so CI stays green. | Resolved in 4056124, verified in the re-check (2026-10-23). Originally returned. Fix: record Issued on the server when the transaction is applied, or allow Issued for a quote linked to that policy. Add a test. |
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

## Re-check — 2026-10-23

Reviewed `git diff 39d6cbf..a05669e` (commits 4056124 and a05669e). I checked each claim in 05 "Code review fixes" against the code.

### Earlier findings

| Finding | Status | Evidence |
| --- | --- | --- |
| M1 product pin | **Resolved** | `quote.service.ts:507`: `withServerOwnedFieldsFrom(normalizedPayload, row.payload)` drops the client's `productSnapshot`, `productVersion` and `governanceLineage` and copies the stored values. `insertDraftQuote` strips them. New tests cover the swap and the autosave; the swap test also passes when the stored pin is absent, because the client value is still dropped. |
| M2 older ratings in other statuses | **Resolved** | `quote.service.ts:512-515`: reset when `row.underwriting != null` and the status is not Converted or Issued. The test with an older Expired quote resets it and bind refuses. |
| M3 policy-transaction audit save | **Resolved, with a new Minor (N1)** | Issued is accepted in any state that is not final. Bind refuses Converted and Issued twice, early (`quote-bind.service.ts:374`) and under the lock (`:692`). Tested. |
| Minor: create accepts any status | **Resolved** | `insertDraftQuote` and the in-memory create accept only Draft, and the route passes AppError through. Intake (`submission-intake.service.ts:1097`) and `PolicyViewPage.tsx:570` both send Draft. |
| Minor: in-memory fallback | **Accepted** | Development only (05). The human approver should confirm at Gate C that production never runs without a database. |
| Minor: `ratingNeedsRefresh` not cleared | **Not resolved** | The reset was added at `QuoteWizard.tsx:1247`, which is in the read-only policy-version load effect. `loadQuoteFromServer` (around line 1978-2040), the path that opens another quote, still does not clear the flag. Fix: call `setRatingNeedsRefresh(false)` next to `resetBindingState()` there. |
| Minor: test gaps | **Partly resolved** | Added: the race, the REQ-2 unrated-draft bind, and Expired. Still missing: HTTP-level tests of the route, the wizard-state tests, and the `buildWizardQuotePayload` stability fixture. The race test only proves the interleavings that happen to occur. With an in-process `Promise.allSettled`, the save usually wins before bind's long first phase, so the branch where bind wins rarely runs. |
| Minor: documents | **Resolved** | 02 and API.md now say "accepted as it stands", and the status and pin rules are documented. |

### New findings

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Minor | server/src/services/quote.service.ts:488-518 | N1. Any client can now set Issued on any unbound quote (Draft, Rated or Expired). This departs from Gate A answer 2 ("Issued and later statuses are server-owned"). Binding is not bypassed: an Issued quote cannot be bound. | A user with `page.wizard.view` in the tenant marks another user's Rated quote Issued. It can no longer be bound, and the quote list shows Issued with no policy. A re-rate through `POST /quotes` with that quoteId (below) makes it Rated again. | Accepted for this package if the human approver agrees at Gate C. A follow-up should have the policy-transaction endpoints record Issued on the server, then remove the client Issued. |
| Minor | server/src/lib/rating-fingerprint.ts:38; quote.service.ts:507, copyQuote | N2. The product pin is carried even after a rating reset, including when the user switches product. The stored draft can then hold product B with product A's `productSnapshot`. `copyQuote` also still copies the pin into a new draft, which contradicts "new drafts drop client values". | Low impact today. Rating re-pins (`pinToCurrentProduct`) and bind needs a rating. But any future consumer that resolves the pin from a draft (`ensureProductSnapshots`, as in `/ai/quotes/insights`) gets `PRODUCT_VERSION_NOT_LOADED` for that draft. | Returned (small fix: drop the pin fields when `ratingReset` is true or when the product code changes, and strip them in `copyQuote`). |
| Info | server/src/services/quote.service.ts:206-214 | Not part of this diff. A re-rate through `POST /quotes` with a quoteId does not check the status, so it moves an Issued policy-transaction quote back to Rated. That quote has no `converted_policy_id`, so it can then be bound as new business. Underwriting runs again, so this is not an underwriting bypass. Before this PR it was easier: such quotes could be bound directly. | A duplicate new-business policy is created from a renewal or rewrite quote. | Separate work item: re-rate should refuse Converted and Issued quotes. |

### Questions from the coordinator

- **Could a stale Issued quote matter?** It cannot be bound, and its draft saves no longer reset anything (a final status). The stale-quote job ignores it, which is harmless.
- **Can an old pin be carried forward?** Yes, after a reset or a product switch (N2). Binding still requires a new rating, and the new rating re-pins.
- **Do intake or AI flows trigger the reset?** No. Intake and AI create drafts through `insertDraftQuote`, which has no underwriting, so nothing resets. Only the draft PATCH route calls `updateDraftQuote`.

### Checks run at a05669e (Node 24.21)

- Server typecheck: clean.
- `server: npx vitest run quote fingerprint` passed 37/37.
- `frontend: npx vitest run src/features/wizard` passed 113/113 in 12 files.
- The integration suite could not run locally (no PostgreSQL). I read the tests but could not verify the developer's 43/43 claim.
- `gh pr checks 398` on the new head: Build/Test/Typecheck, DB Integration Tests, Playwright E2E and pilot were still pending when I checked.

### Gate C (review view)

**Not blocked by code review.** No Blocker or Major findings are open. Open Minors:
- `ratingNeedsRefresh` on quote load (not resolved);
- N2 stale pin;
- the remaining test gaps.

N1 and the in-memory fallback need the human approver's explicit acceptance. CI on a05669e must be green before merge.
