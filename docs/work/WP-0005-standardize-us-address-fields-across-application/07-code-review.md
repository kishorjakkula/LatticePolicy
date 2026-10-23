# Code Review - WP-0005

- Reviewer: independent Codex session, separate from the developer, requested by the maintainer.
- Scope: working-tree diff against HEAD `c55b6bd`, relevant new address runtime/tests/docs, and the subsequent customer identity-preservation fix. Unrelated untracked research/output excluded.
- Context: AGENTS.md, reviewer contract, project/testing/contributor/UI guidance, delivery workflow, and work-package 01 through 05. Gates A/B approved per the request; no gate records changed.
- Latest decision: R1-R7 independently verified fixed. No open review findings remain in the reviewed scope. Full PostgreSQL/browser results below are parent-reported, not independently rerun. The previous two-case browser run passed six executions; a new three-case, three-repeat run (nine executions) is in progress and supersedes it for final coverage. No human gate, PR, CI, merge or deployment approval is implied. The reported existing moderate ip-address dependency advisory remains pending the separate security/compliance review, not resolved by this code review.

## R7 Resolution

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Minor (P2), R7 | `frontend/src/components/address-fields.css:9` through `:10`; control at `frontend/src/components/AddressFields.tsx:84` | Original scoped contrast fix omitted the suggestion panel's Keep entered address button. | Previously the result-state button inherited pale text on white in dark mode. The broadened .postal-editor .btn-secondary normal/hover selectors now include it without affecting global buttons. | Fixed; independently rechecked. |

Verified R7 correction: normal and hover rules now target .postal-editor .btn-secondary, covering Check and Keep, while retaining the separate toolbar selector for Add. Final label rules use --ps-text-secondary and component surfaces/text remain explicit. Independent headless Chromium probe with the actual global/component stylesheets and a visible comparison button at 390/1440 in both themes verified: dark normal text rgb(232,240,255) on rgb(15,33,61), dark hover on rgb(9,18,36); light normal text rgb(26,32,44) on white, light hover on rgb(247,248,252). Label colors were rgb(74,85,104) light and rgb(155,176,207) dark. No app/provider calls, screenshots or output files were generated. The original pale-on-white failure is reversed. The newly added third browser case now supplies the previously suggested mocked-provider candidate-state axe journey; execution remains pending in the latest parent update.

## R6 Resolution

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Major (P1), R6 | `server/src/routes/customers.routes.ts:1270` through `:1272` | Original replacement comparison omitted entityType from contact-only authorization. | Previously a contact-only caller could change BOTH to INDIVIDUAL with unchanged identity sections. The corrected guard rejects either changed identity or changed entityType before validation/persistence. | Fixed; independently rechecked. |

Verified R6 correction: the guard now checks `!identityUnchanged || existing.entityType !== input.payload.entityType` when allowIdentityUpdate is false. Both values come from the normalized loader/input paths. The route still derives the restriction from contact.manage present/manage absent and maps IDENTITY_EDIT_FORBIDDEN to HTTP 403. The unchanged-identity persistence optimization remains separate and intact.

Independent post-fix regression probe used exported loadCustomerRecordById, normalizeCustomerInput and updateCustomerRecord with a synthetic query adapter, not a real database. With allowIdentityUpdate=false, BOTH -> INDIVIDUAL and BOTH -> COMPANY each returned IDENTITY_EDIT_FORBIDDEN with zero write queries. An identity.middleName change was also rejected with zero writes. An address-only update succeeded with zero person/company identity writes. Assertions passed for all four cases. The original pre-fix probe had reached the customer write; this result independently verifies its reversal without changing any real customer data.

Inspected the new real PostgreSQL/API regression in `server/src/__tests__/contact-address.integration.test.ts`: it logs in as customer_service, asserts contact.manage is present and manage absent, attempts both entity-type changes with the restricted token, expects 403 IDENTITY_EDIT_FORBIDDEN, then checks identity/version/entityType remain unchanged. The encrypted-DOB address PATCH also now uses the restricted token and still compares ciphertext/hash before and after. Test construction covers the requested permission path. Latest parent update reports these cases passing in the fresh full RLS suite; reviewer did not rerun that database suite.

## Resolved Findings

| Original severity | Location | Original issue | Verified correction | Outcome |
| --- | --- | --- | --- | --- |
| Major (P1), R1 | `server/src/lib/idempotency.ts:198` | Case/trailing-slash check aliases retained private results and replayed before endpoint authorization. | Case-insensitive optional-trailing-slash exemption now matches the accepted aliases. Route tests verify the supplied key cannot replay to a no-permission principal and configuration is reevaluated. New scoped 4 KB parser and sanitized error handling verified separately below. | Fixed; independently rechecked. |
| Major (P1), R2 | `frontend/src/features/wizard/QuoteWizard.tsx:253` | Primary email edits left applicant.email stale, allowing notification delivery to the old address. | Payload construction derives applicant.email from normalized primary insured email, including an explicit empty value; inline primary edits also synchronize q.applicant.email. Updated/cleared-email payload tests and notification resolver tests pass. | Fixed; independently rechecked. |
| Major (P2), R3 | `frontend/src/shared/postalAddress.ts:27`; garaging editor call sites | Structured ZIP+4 entered the five-digit rating field and was overwritten in the displayed postal value. | ratingZip projects a valid US ZIP+4 to five digits. AutoRiskEditor, DynamicRiskForm and both legacy CreateQuotePage auto variants use it and prefer the full structured postalCode when rendering. Unit projection coverage passes; non-US postal values are not sliced. | Fixed; independently rechecked. |
| Major (P2), R4 | `frontend/src/features/wizard/QuoteWizard.tsx:2576` | Late read-only contact-detail GET overwrote newly edited draft address collections. | Read-only GET no longer calls syncInsuredFromContactDetail. Generation guards discard late success/error/finally updates after close/switch/unmount. Deferred-response component test closes the popup, edits a unit, resolves the stale read and verifies saved draft retains the edit. | Fixed; independently rechecked. |
| Minor (P2), R5 | `server/src/services/quote-bind.service.ts:334` | Bound primary interest projection omitted line3/county and truncated non-US regions. | Projection preserves line3/county, longer non-US regions and postal codes. Updated projection test passes. US state compatibility and full collection in the version snapshot remain intact. | Fixed; independently rechecked. |

## Customer-Save Security Review

- Read the complete updateCustomerRecord change and its callers, previous identitySectionsChanged guard, masked-record loader, normalization, validation and person/company persistence helpers.
- When normalized identity is unchanged, preserveIdentity skips both person/company upserts. The encrypted-DOB presence check uses the server-loaded existing record, not a client-supplied dobEncrypted value. It relaxes only the DOB/SSN-presence condition for an unchanged identity with an existing encrypted DOB. No decryption or new disclosure is added by this change.
- Independently exercised the corrected permission boundary and preservation using the four post-fix probes recorded above. Entity-type and identity-field changes are rejected before writes; address-only updates avoid person/company upserts.
- The PostgreSQL regression now uses the contact-only token for the encrypted-DOB address PATCH and adds explicit entity-type denial cases, replacing the earlier admin-only coverage gap. The parent reports the fresh PostgreSQL run passed; reviewer did not independently rerun it.

## Latest Independent Verification

- Server: 5 files, 33 tests passed: address-routes, address-check, notification.service, quote-additional-interests and document-policy-detail-tokens.
- Frontend: 3 files, 19 tests passed: ContactAddresses, companyChange and CommonQuoteSections.
- Actual createApp/Supertest parser probes against canonical, trailing-slash and uppercase address-check URLs: malformed synthetic JSON returned 400 INVALID_ADDRESS_INPUT; a body over 4 KB returned 413 PAYLOAD_TOO_LARGE. All six responses omitted the synthetic private marker. No live provider requests were made.
- R1 route regression covers editor then no-permission principal under the same key/body, then disabled provider under that key. Exactly one mocked provider call occurs. This reverses the original reproduced unauthorized replay.
- R3 source inspection covers every changed garaging editor, including both products in CreateQuotePage. Unit tests prove the postal ZIP+4 remains intact and ratingZip returns the five-digit projection; a dedicated non-default-territory end-to-end assertion is still not claimed.
- R4 deferred read/close/edit/save regression passes. Switch/unmount generation guards were inspected; no separate switching browser reproduction is claimed.
- Strict request-envelope/nested-key rejection, fixed provider host, no redirects, bounded provider body/candidates, sanitized failures and tenant/principal matching-control invalidation remain present. Latest independent address-check/address-routes rerun passed 25 tests across 2 files, including stalled-fetch/stalled-body aborts, pinned-carrier denial, and tenant/principal rate-bucket isolation. Timeout tests verify aborted signals/unavailable sanitized results; limiter test verifies 20 outbound checks, 429 without outbound traffic, then independent other-tenant and other-principal calls.
- Reviewed the enhanced browser coverage: scoped axe checks have no exclusions/disabled rules, assert zero violations, check page overflow and save scoped screenshots at 1440/390 widths in light/dark themes. Initial two cases cover contact and garaging editors; the new third case audits the visible candidate result, including Keep/Apply. Scoped CSS selectors do not affect global secondary buttons or remove focus styles. The separate independent post-fix browser fixture above verifies R7's matching-state button colors.
- No database/browser integration suite, deployment, commit or gate change was performed by this reviewer. Only this review artifact was edited.

## Earlier Evidence And History

- Initial review returned R1-R5. Independent pre-fix probes demonstrated alias idempotency storage/unauthorized replay, ZIP+4 validator rejection, stale notification recipient and dropped interest projection fields. The popup overwrite was initially source-traced. Those descriptions are historical, superseded by the verified corrections above.
- Earlier independent focused checks passed 23 server and 9 frontend tests but did not exercise the original findings. Latest focused counts above include the new regressions.
- Parent-reported pre-fix broader checks: frontend 600/backend 961, fresh RLS PostgreSQL 301, typecheck/build/architecture all passed; one public-address Census smoke matched without private data. Initial browser batch was 13/15; State locator corrected, and duplicate-form strict-selector failure attributed to reused integration DB. Browser checks restarted on a separate fresh DB without weakening quoted-document assertions.
- Previous parent update reported focused frontend 16/server 15 passing and an added encrypted-DOB PostgreSQL regression. Latest update reports the R6 guard and restricted-user API regressions added, with a fresh PostgreSQL suite running and the changed integration file scheduled for another fresh database afterward. These remain parent-reported execution status, not an independent passing PostgreSQL claim.

Latest parent-reported completed verification: fresh exact-name disposable RLS PostgreSQL 302 tests / 43 files, including restricted-user masked-DOB PATCH and both forbidden entity-type changes; full browser 164 passed; full server 971 tests / 95 files passed. Final enhanced browser specs repeated three times: 6 passed in 29.4 seconds, covering 1440/390 light/dark scoped axe, page/table bounds and screenshots. Reviewer did not independently rerun those full suites or inspect the parent screenshots.

## Final Mobile/Table Follow-Up

- Reviewed the added component surface/text tokens, scoped primary table-link color, table-actions wrapper and mobile table min-width reset. The existing table-actions flex-wrap and mobile-card direct-child rules now apply to the action group; handlers and read-only permissions are unchanged. Component background is explicit rather than relying on a screenshot's transparent canvas. No global style changes were introduced by these scoped rules.
- Inspected the stronger browser assertion: it checks the contact table container's scrollWidth <= clientWidth in addition to document bounds. This detects internal horizontal clipping missed by the original page-only assertion. Existing axe zero-violation checks, themed widths, save/reopen and ZIP+4 assertions remain in place.
- Independent ContactAddresses component run: 1 file, 7 tests passed.
- Independent headless Chromium fixture using the actual global/component CSS and mobile-card table markup: at 390 and 1440 in both light/dark themes, postal-table scrollWidth equaled clientWidth, action flex-wrap was wrap, component backgrounds were opaque white/light or rgb(15,33,61)/dark, and action links used the scoped primary token. This is isolated CSS verification, not a rerun of the app journeys or visual inspection of the parent's screenshots; no screenshots were written.
- No additional finding in the mobile/table changes. R7 initially remained after that intermediate revision, then was independently rechecked and fixed by the broadened .postal-editor selector as documented above.
- The two enhanced browser specs' three-repeat run is now parent-reported passing all six executions in 29.4 seconds.

## Mocked Matching Browser Coverage Follow-Up

- Independently inspected the new third case in e2e/contact-addresses.spec.ts and its synthetic customer helper. Capabilities and address-check responses are intercepted in the browser; no live Census data is needed. The helper's mixed-case street makes the uppercase suggested value observably different, so Apply is not a vacuous unchanged-value assertion.
- Check is asserted disabled before explicit consent. The check handler asserts the request envelope contains only address and that address contains no email/phone. Full nested-key schema rejection and provider-boundary minimization remain covered by server tests; this browser assertion alone does not claim to prove those complete contracts.
- A visible candidate is awaited before asserting the original remains unchanged and before the four light/dark, 1440/390 axe/bounds/screenshot checks. Keep retains the original; renewed consent and a second Check then Apply change the draft to the suggested value. Exactly two intercepted checks and zero matching customer PATCH requests are asserted. The test does not call Save, correctly distinguishing draft application from persistence.
- No new actionable finding in this coverage or the current R7 CSS. The latest parent run is all three cases repeated three times (nine executions), still running in the supplied update. Earlier six-pass evidence applies only to the preceding two-case revision; it is not represented as a passing nine-execution run. Reviewer did not start a competing integration/browser run.

R1-R7 are fixed. No open code-review findings remain. Existing dependency advisory disposition remains with stage 08; no security waiver or clean-CI claim is made. Human gates remain unchanged. Only this review artifact was edited.
