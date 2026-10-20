# Code review — WP-0004

> Code reviewer (separate session from the developer). Fill every placeholder below (the flow will not complete the stage while any remain).

- Reviewer session / tool: independent Code Reviewer agent session (Claude Code, stage 7), separate from the developer sessions.
- Diff reviewed: `git diff origin/main...840b443` (PR #392, branch `latticepolicy/wp-0004-ui-flow`, base 2a9bc64). Phase 1 only.

## Code review — Phase 1 — 2026-10-20

Scope: REQ-3, REQ-4, REQ-6, REQ-7, REQ-13, REQ-14 (Submissions list), REQ-18, the wireframe removal and the not-found route.

Result: **returned to the developer.** One major finding is open. There are no blockers.

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| Major | `frontend/src/features/policies/PolicyViewPage.tsx:109-110,919`; `frontend/src/features/customers/CustomerViewPage.tsx:35-36,338-339,392-393` | Two date-time columns lost their time. The removed `formatLedgerTimestamp` and the old customer formatter printed `MM-DD-YYYY HH:MM`. Their replacements call `formatDisplayDateTime(value, { fallback })` without `includeTime: true`, and that function returns the date only unless `includeTime` is set. The comment in `CustomerViewPage` ("US: MM/DD/YYYY h:mm AM/PM") and `05-implementation.md` both describe output the code does not produce. | A policy has an endorsement and a cancellation processed on the same day. The Transactions "Updated" column (the default sort, descending) shows `10/17/2026` for both rows, so the user cannot see which came first. The customer page's policy and quote Created/Updated columns lose their times in the same way. This fails the REQ-7 acceptance criterion "date-times include AM/PM" and regresses the old display. Checked: `formatDisplayDateTime('2026-10-17T14:05:00Z', {fallback:''})` returns `10/17/2026`. | Returned. Fix: pass `includeTime: true` in both helpers. Add a unit test that asserts `h:mm AM/PM` in the Transactions Updated cell and the customer view rows. |
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
