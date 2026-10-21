# Code review — WP-0004

## Current Merge Status (2026-10-21)

Independent re-review passed for the proposal-binding extension: no remaining
open blocker/major finding identified. Gibbs (separate session
`01a15f67-4d5e-7c22-b316-08cd03bc7814`) reviewed the migration, canonicalization,
four callers, rollback boundary, concurrency and frontend evidence display.
Independently ran 174 focused server tests and 29 frontend tests, all passed.
Did not independently rerun PostgreSQL/browser suites; parent results are in
their separate handoffs. Phase 1 sections below are historical. Gate C remains
a human action; local review does not assert remote CI is green.

Independent sessions Mendel and Boyle reviewed the Phase 2/3 changes. Findings:

| Severity | Finding | Outcome |
| --- | --- | --- |
| Major | Rejected endorsement/renewal/rewrite rolled back their referral, so explicit review could not complete. | Fixed with rollback-first work-item retention; real HTTP tests cover all three flows and concurrent attempts. Independent review found no further rollback/lock-order issue. |
| Major | Ordinary approval reused when new authority requirements appear. | Fixed: exact proposal binding and escalation HTTP regression; independently re-reviewed. |
| Major | Approved, unconsumed referral can authorize materially increased exposure producing the same reason code. | Verified fixed: approved Migration 069, immutable evidence/hash and changed-limit regressions in all four flows. Gibbs independently re-reviewed. |
| Major | Concurrent new-business binds can spend one unconsumed approval twice. | Verified fixed: quote and approval locked/revalidated in the policy-creation transaction; concurrent real HTTP regression creates exactly one policy. |
| Major | A client field named redactedSha256 hides sibling material facts in the detail view. | Verified fixed: singleton 64-hex marker only; sibling risk/coverage regression added. |
| Minor | Different proposal shadows an exact-match approval and creates duplicate work. | Verified fixed: select latest decision within the matching fingerprint; A/B/A regression. |
| Minor | Tenant/user count-cache isolation, pending Escape/double-submit, focus escape after failure. | Parent fixes and focused regressions added; independent recheck verified the dialog corrections. |
| Minor | Forced-white dark primary/active-page text and populated search contrast. | Token corrections and browser checks added; final combined run pending. |
| Minor | Renewal dates shifted at UTC midnight. | Local calendar bounds and New York/Tokyo regressions; independently verified fixed by Boyle. |
| Minor | Pager mobile-close/desktop-resize race and obsolete referral queue selectors. | Corrected with a mobile-only disclosure and stable-ID/detail-view tests. Final combined browser evidence recorded in automation handoff. |

No reviewer approved Gate C or business sign-off. No merge or production
deployment was performed in this continuation.

> Code reviewer (separate session from the developer). Fill every placeholder below (the flow will not complete the stage while any remain).

- Reviewer session / tool: independent Code Reviewer agent session (Claude Code, stage 7), separate from the developer sessions.
- Diff reviewed: `git diff origin/main...840b443` (PR #392, branch `latticepolicy/wp-0004-ui-flow`, base 2a9bc64). Phase 1 only.

## Code review — Phase 1 — 2026-10-20

Scope: REQ-3, REQ-4, REQ-6, REQ-7, REQ-13, REQ-14 (Submissions list), REQ-18, the wireframe removal and the not-found route.

Historical first-pass result: returned to the developer with one major finding.
It was fixed and independently re-reviewed below; it is not currently open.

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Major | `frontend/src/features/policies/PolicyViewPage.tsx:109-110,919`; `frontend/src/features/customers/CustomerViewPage.tsx:35-36,338-339,392-393` | Two date-time columns lost their time by omitting includeTime. | Same-day transactions and customer records could not be distinguished by their displayed time. | Verified fixed by the Phase 1 independent re-review below: includeTime true and date-time regression assertions. |
| Minor | `frontend/src/features/policies/policyPremium.ts:79-93` | The term premium adds every in-term transaction, including a second full-term transaction. A rewrite stores a full-term premium, not a delta. When a rewrite's term dates equal the original term's, NB + Cancel + Rewrite are all added. This is not a regression: the old code did the same. | NB $500, mid-term cancel −$300, then a rewrite effective on the original inception date for $520. The header shows $720 instead of $520 (reproduced with Node). | Returned (minor). Suggested fix: restart the running total at each NB, Renew or Rewrite version (`cumulative = amount`) instead of adding to it. Add a unit test for this case. |
| Minor | `frontend/src/features/policies/PolicyViewPage.tsx:1188` | The non-renew modal still builds its own date: `new Date(expirationDate).toLocaleDateString()`. This parses a date-only value as UTC and ignores the tenant's format. REQ-7 covers policy screens. Pre-existing. | A user west of UTC opens Non-renew for a policy that expires on 09/18/2027. The modal says "9/17/2027", one day early, on a notice-related screen. | Returned (minor). Use `formatDisplayDate`. |
| Minor | `frontend/src/shared/dateDisplay.ts:122-124` | Every stored US `MM-DD-YYYY` setting is read as `MM/DD/YYYY`, including one an admin chose on purpose. `TenantPage` still offers `MM-DD-YYYY` for the US and saves it without any effect. | A tenant admin picks MM-DD-YYYY for the US and saves. The setting is stored but never displayed, with no message. | Accepted for Phase 1 because it is documented in `05-implementation.md`. Follow-up: hide or relabel that option for the US, or migrate the stored data. |
| Minor | `frontend/src/features/policies/PolicyViewPage.tsx` (status badge), `frontend/src/features/search/PolicyRow.tsx:9-11`, `SearchPage.tsx:1247-1258` | The workflow status "Bind" is still shown raw in the badge, but the legend calls it "Bound". The search legend shows a "Bound" badge, while result rows show "Bind". | A user reads a "Bind" row, opens "What the statuses mean", and finds no "Bind" entry. This is a REQ-4 display-name gap. | Returned (minor). Show "Bound" for `Bind` in the badge, or key the legend on the badge text. |
| Minor | `frontend/src/features/policies/PolicyDocumentsPanel.tsx:36-41` | A form document gets a distinct name only when its stored title ends in a bracketed code. Without a code it falls back to "Policy form — <transaction>". | A transaction produces two filled forms that have titles but no codes. Both rows read "Policy form — New business" and differ only by transaction number. | Returned (minor). Fall back to the title when there is no code. |
| Minor | `frontend/src/features/search/search.css` (`.ps-status-legend`) | `color: var(--ps-text-body)` refers to a token that is not defined anywhere in `frontend/src`. | The rule does nothing, and the legend text inherits whatever colour its parent has. | Returned (minor). Use `--ps-text-secondary` or define the token. |
| Minor | `frontend/src/features/submissions/submissions.css:49-50` | `.si-btn-primary` still uses `--accent` (#2d64e3). Every other primary now uses `--ps-primary` (#4361ee). | The Submissions inbox and review screens show a second primary blue, contrary to REQ-6 "one primary token". | Returned (minor), or record it as deferred to Phase 2 with the submission work. |
| Minor | `frontend/src/styles.css:4980-4981` | In dark mode, `--ps-on-primary` (#fff) on `--ps-primary` (#5f7eff) has a contrast of 3.55:1. Button labels are 0.9rem and need 4.5:1. The old value (#39a4ff, 2.65:1) was worse, so this is an improvement but still fails. | Every primary button in dark theme fails WCAG 1.4.3. | Accepted for Phase 1 (improvement). Track under REQ-15. |
| Minor | `frontend/src/components/Pagination.tsx:96` (now rendered by 16 `TablePagination` call sites) | `role="list"` is set on the controls container, but its children are buttons with no `listitem` role. This is pre-existing in `Pagination`, but it now appears on every table pager. The "Showing x–y of N" total is also gone from those screens. | Axe reports "list must only directly contain listitem" on every admin table. Users of the Users, Customers and other admin lists no longer see a total count. | Returned (minor). Drop `role="list"`. Decide with UX whether the total count stays. |
| Minor | `frontend/src/features/policies/PolicyViewPage.tsx:631-642`; `PolicyAsOfPanel.tsx` | (a) If `policy.customer` is an object with no id, key or name, the insured fact renders empty instead of "No insured linked". (b) Clicking "View as of" in the header renders the result card far down the page, with no focus move or live announcement. | (a) A blank Named insured fact. (b) A keyboard or screen-reader user submits the date and hears nothing. | Returned (minor). |
| Minor | `docs/tasks/wp-0004-ui-consistency-part-c.md` "Not done here"; `05-implementation.md` REQ-6 | The task note says PlacementsPage and the catch-all route are not done, but both are done in this diff. `05-implementation.md` lists REQ-6 as done in Phase 1, but "Cancel policy last, in the danger style" is not implemented: the Cancel button is still second and labelled "Cancel". | The next agent trusts stale notes. | Returned (docs). Update the task note, and record the action ordering as deferred to Phase 2 (REQ-12). |

### Verified (no finding)

- **Current-term premium.**
  - Version dates are serialised from Postgres `date` columns. On a UTC server that gives `…T00:00:00.000Z`, which the regex in `toLocalDateOnlyKey` reads by calendar date. A non-UTC server (`…T04:00:00Z`) falls back to the local date, which is correct for browsers in the same or an eastern time zone.
  - Cancel and reinstate deltas and the zero-premium reinstatement rule behave as before. `reconcileReinstatementPremiums` runs first, but nothing is double counted.
  - The old "sum every term" fallback is gone. When no version matches, the header falls back to `policy.premium` (`premium_summary`, the last full-term premium), not the last delta. No case was found where the old code was right and the new code is wrong.
  - Out-of-sequence transactions are stored as single delta versions, so their order affects only the cancel/reinstate pairing.
- **Server dates.**
  - No server code uses `dateFormatsByCountry` for documents, exports or emails. It is used only in the config and admin routes, so the default change affects nothing outside the UI.
  - Date-only values stay time-zone safe in `parseDateValue` and `renderDate` (the UTC path).
- **Display labels.**
  - All transaction types the server writes (NB, NewBusiness, Endorse/Endorsement, Cancel, Reinstate, Renew/Renewal, Rewrite, NonRenewal, Issue) map to names. `QuoteBind` and `Audit` read as "Quote bind" and "Audit".
  - The documents route returns `transactionType`, so "Policy packet — Renewal" works.
  - The Details button's accessible name contains its visible text (WCAG 2.5.3).
- **CSS.**
  - `--ps-primary` and the new tokens are defined on `:root`, so the bare `button` rule resolves on the login page, the customer portal and icon buttons. The only change there is the blue hue (#2d64e3 to #4361ee; dark mode #39a4ff to #5f7eff).
  - Contrast in light mode: primary 5.02:1, primary hover 6.39:1, danger text 6.57:1 on white and 6.05:1 on the hover fill.
  - The select padding rule (0,2,1) beats class padding, but every single-line select keeps an explicit height (40px from the base rule, 34px for the pager, 42px in the wizard). No select collapses.
  - The `:where(details)` marker reaches the 15 `<summary>` elements listed by grep. The classed summaries already used the same circle marker.
- **Pager.** `TablePagination` callers' props behave as before: options default to [10, 20, 50], the in-use size is added to the picker, and client-side slicing is unchanged.
- **Search.** `parseSearchPageSize` limits the URL value to 1–100. The server also caps it at 100 (`policies.routes.ts:64`, `quote.service.ts:634`).
- **Routes.**
  - The `*` route does not catch nested admin paths: `/admin/xyz` matches no child, so it falls through to NotFound outside the admin shell, and known admin paths still match first.
  - `/login` and `/portal` match before the catch-all.
  - Unauthenticated users on an unknown path go through RequireAuth to login.
- **Insured link.** `/customers/:id` calls `getCustomer(idOrKey)`, which accepts both the customerId and the customerKey.
- **Tests.**
  - The new unit tests assert behaviour, including the time-zone test, current term against all terms, the header facts and the page-size picker.
  - The e2e selector changes are at least as strict as before: rows are found by `data-document-id`, and there are negative checks for raw codes and version IDs.
  - The e2e premium check (`Premium this term $x.xx`) does not compare the amount. The unit tests cover the amount.

### Checks run (Node 24.21, working tree identical to 840b443)

- `cd frontend && npx vitest run src/features/policies src/shared src/components src/features/search src/features/submissions src/features/admin/forms src/features/admin/__tests__/FormsManagementPage.scopeFilter.test.tsx src/__tests__`: 27 files, 179 tests passed.
- Node probes against copies of `policyPremium.ts` and `dateDisplay.ts`:
  - rewrite at inception gives $720 (the minor finding above);
  - IST browser with dates from a US server is correct;
  - `formatDisplayDateTime` without `includeTime` returns the date only (the major finding);
  - an explicit US `MM-DD-YYYY` setting is rewritten to slashes;
  - `new Date('2027-09-18').toLocaleDateString()` in New York gives 9/17/2027.
- Contrast ratios computed for the new tokens.
- No Docker or e2e runs.

### Merge

The major finding blocks Gate C until it is fixed and re-verified. The minor findings can be fixed in this PR or recorded as Phase 2 or Phase 3 follow-ups.

## Re-check — Phase 1 fixes — 2026-10-20

Diff reviewed: `git diff 840b443..f66b308`. The working tree was identical to f66b308 for `frontend/`. Same reviewer session as above.

Result: **the major finding is resolved. Nothing blocks Gate C.** Two minors stay open as non-blocking follow-ups (the policy-header "Bind" text and the form-document naming path), plus the two accepted minors.

| Finding | Status | Evidence |
| --- | --- | --- |
| Major: date-times lost their time | **Fixed** | Verified: `PolicyViewPage.formatDateTime` and `CustomerViewPage.formatDateTimeMmDdYyyyHm` pass `includeTime: true`; document/audit/submission date-time call sites and the policy-header regression passed the independent Phase 1 re-review. |
| Minor 1: rewrite on the original term adds up | **Fixed** | `startsTermPremium` resets the running total and the pending cancel at NB, NewBusiness, Renew, Renewal and Rewrite. Leaving out Issue is correct: a $0 Issue version would otherwise wipe the term. Node probes on f66b308: rewrite at inception gives 520 (was 720); flat cancel then rewrite gives 520; NB + $0 Issue + $20 endorsement gives 520; the earlier cases are unchanged. The new unit test (500, −300, 520, +15 gives 535) passes. |
| Minor 2: non-renew modal date | **Fixed** | `PolicyViewPage.tsx:1188` uses the module's date-only `formatDate` (the shared formatter with the UTC path). |
| Minor 3: legacy US format | Accepted, follow-up | Recorded in `05-implementation.md`. |
| Minor 4: "Bind" against "Bound" | **Partly fixed, open (minor)** | Correction to my first review: search rows and the search legend both render through `StatusBadge`, which already shows "Bind" as **"Bound"** (`StatusBadge.tsx:30`). The search screen was therefore consistent before and still is. The legend key is now `Bind`, so the tooltip lookups in the header and search rows work without the remap. The **policy header badge** is a plain span that still shows the raw text "Bind" (`PolicyViewPage.tsx`, status slot), so it still differs from "Bound" on search. Follow-up: render the header status through `StatusBadge` or the same label. |
| Minor 5: form document names | **Resolved in practice. The new code path is not reached by the real API.** | Form documents store `metadata.code` and `metadata.title` (`document-generation.service.ts:548-549`), and the route builds `displayName` as `Title [CODE]`. `code` is always set because it is upper-cased during selection, so the bracket regex already gave distinct names. The new `doc.forms[0]` branch never runs for real form documents: the route sends `forms: metadata.forms || []`, and form documents have no `metadata.forms`. The new unit test uses a shape the API does not return. This is harmless and does not block. Follow-up: read `title`/`code` from the route, or drop the branch. |
| Minor 6: undefined token | **Fixed** | `search.css` now uses `--ps-text-secondary`, which is defined on `:root` and in dark mode. |
| Minor 7: second primary colour | **Fixed** | `.si-btn-primary` uses `--ps-primary`, `--ps-on-primary` and `--ps-primary-hover`. |
| Minor 8: dark-mode contrast | Accepted, follow-up | Tracked under REQ-15. |
| Minor 9: pager role and lost count | **Fixed** | The inner controls are `role="group" aria-label="Pages"` inside `nav "Pagination"`. `showRange` is opt-in and turned on only by `TablePagination`. The search page keeps its own count and does not double it. With zero items it still shows "No results". The test asserts "Showing 1–20 of 183 · Page 1 of 10" and "Showing 21–25 of 25 · Page 3 of 3". |
| Minor 10: empty insured; as-of feedback | **Fixed** | `!customer \|\| !insuredLabel` shows "No insured linked". In `PolicyAsOfResult` the hooks run before the early return (no change in hook order). The effect scrolls to and focuses the `tabIndex=-1` region after commit when `asOf` changes, and it does nothing when the date is cleared. |
| Minor 11: stale docs; REQ-6 ordering | **Fixed** | The task note now names only UwQueue as pending (Phase 2, REQ-17). `05-implementation.md` records the Cancel ordering as deferred to Phase 2 (REQ-12) and lists the review fixes. |

New defects: none found in the fix diff. Small observation, not a finding: `aria-live="polite"` on the focused as-of region may announce the loading text and then the result. That is acceptable.

Checks run (Node 24.21, from `frontend/`):

- `npx vitest run src/features/policies src/shared src/components src/features/search src/features/submissions src/features/customers src/features/admin/forms src/__tests__`: 26 files, 179 tests passed.
- Node probes of `policyPremium.ts` at f66b308 (results above).
- No Docker or e2e runs.

Merge: there are no open blockers or majors, so the code-review stage is done for Phase 1. Minors 4 (header text), 5 (unreachable branch), 3 and 8 are non-blocking follow-ups. Gate C is the human merge approval.
