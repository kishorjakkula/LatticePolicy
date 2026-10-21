# Test design — WP-0004

## Approved Security Extension (Gate B, 2026-10-21)

`02a-referral-proposal-binding.md` adds immutable reviewed-proposal evidence.
Required regressions: same reason/date but increased limit or materially
changed risk/coverage/premium/base version must not reuse an earlier approval;
unchanged retry after human approval succeeds. Cover new business, endorsement,
renewal and rewrite through real HTTP and PostgreSQL, including concurrent
attempts and failed writes. Unit tests prove canonical key-order stability and
material-input sensitivity. API tests reject client-forged context and evidence
updates, enforce tenant/authority permissions and preserve legacy history.
UI/browser tests compare displayed immutable proposed facts with stored
evidence and require new review on changed/legacy proposals. Migration and
independent security review are required. Gate B was approved with "approved."
Actual results, not this plan, determine completion.

Layers: unit (vitest, server and frontend), component (React Testing Library),
API integration (real PostgreSQL), E2E (Playwright, isolated stack), standards
(source scans), accessibility (axe in Playwright). All data is synthetic.

| Criterion | Case | Layer | Data | Expected |
| --- | --- | --- | --- | --- |
| REQ-1 / 1 | Referral list rows offer only Open | Component (UwQueue) + E2E | 2 open referrals | No Approve/Decline buttons in rows |
| REQ-1 / 2 | Approve with blank reason | Component (decision panel) + API integration | Open referral | Dialog shows "Enter a reason"; API returns 400 REASON_REQUIRED for `/decide`, `/approve`, `/decline`; referral unchanged |
| REQ-1 / 3 | Authority referral without override permission | API integration + E2E | AUTHORITY_ referral, underwriter without override | Approve unavailable with reason; direct API call 403 AUTHORITY_OVERRIDE_REQUIRED |
| REQ-2 / 1 | Each former prompt/confirm action opens ReasonDialog/ConfirmDialog | Component (one per screen) | Users, Compliance, Forms, Customers, Placements, UW | Labelled field, focus inside, Escape cancels with no request sent |
| REQ-2 / 2 | No native dialogs in source | Standards test | frontend/src | Zero `prompt(` / `confirm(` / `window.confirm` |
| REQ-3 / 1 | Policy header identity | Component + E2E | Issued PA policy with insured | Insured link, "Personal Auto", current term dates, status, term premium |
| REQ-3 / 2 | Policy without customer | Component | Policy, no customer | "No insured linked" |
| REQ-4 / 1 | Document and transaction names | Unit (displayNames) + component + E2E | Renewal packet | "Policy packet — Renewal", "PDF"; version ID only inside Details |
| REQ-5 / 1 | Work menu with referral count | Component (AppNav) + E2E | 4 open referrals | "Referrals 4" |
| REQ-5 / 2 | Grouped admin + admin home | Component + E2E | Admin user | Four groups; admin home lists attention items |
| REQ-5 / 3 | Wireframe routes gone | E2E | — | Not-found page |
| REQ-5 / 4 | Nav hides items without permission | Component + role-access-matrix E2E | Agent without referral permission | No Referrals item, no count request |
| REQ-6 / 1 | One primary per group; Cancel last, danger | Component + visual snapshot (Playwright screenshot compare on policy page) | Issued policy | Single primary token; Cancel policy last |
| REQ-7 / 1 | US date formats | Unit (dateDisplay) + E2E | US tenant | MM/DD/YYYY; date-time with AM/PM |
| REQ-8 / 1 | Step 1 field order; no billing | Component + E2E quote-wizard | New quote | Product/state/effective/term first; billing absent until Premium |
| REQ-8 / 2 | Old draft reopens | E2E | Draft saved with billing before change (fixture) | All values present in their new steps |
| REQ-9 / 1 | Needs attention default + group summary | Component + E2E submission-intake | Submission, 54 not found | Filter selected; "0 of 10" summaries |
| REQ-9 / 2 | Bulk accept count | Component | 12 high-confidence values | Dialog states 12 before any change |
| REQ-10 / 1 | Bulk compliance change | API integration + E2E | 10 HO states | 10 rows updated, 10 audit rows with reason |
| REQ-11 / 1 | Zero bar | Component (dashboard) | Draft = 0 | Bar width 0 |
| REQ-11 / 2 | Forecast only future | Unit (dashboard model) | Month = Oct | No forecast for May–Oct |
| REQ-12 / 1 | Reinstate on in-force policy | Component + E2E policy-lifecycle | In-force policy | Not offered or reason shown |
| REQ-13 / 1 | Page size matches | Component + E2E dashboard-search | 183 policies, size 20 | Picker 20; "Page 1 of 10" |
| REQ-14 / 1 | No horizontal scroll at 390px | E2E (new mobile project) | All in-scope routes | scrollWidth == 390 |
| REQ-15 / 1 | Names and contrast | E2E axe | In-scope routes | No name/contrast/target violations |
| REQ-16 / 1 | Hex colour rejected | Standards test | Fixture string | Test fails on a literal outside styles |
| REQ-17 / 1 | Triage columns, oldest first, assign | API integration (sort, premium) + component + E2E uw-referrals | 3 referrals of different ages | Oldest first; assign sets assignee |
| REQ-18 / 1 | Forms list readability | Component | HO-BINDER, unscoped form | One line; View/Edit; "All states" |
| REQ-19 / 1 | AI audit paging and filters | API integration + component | 500 synthetic entries | 25 per page; model/user/date filters narrow results |

## Negative, authorization and tenant-isolation cases

- **Referral decisions.**
  - Blank or whitespace reason returns 400 on all three decide routes.
  - Without `uw.referrals.decide`: 403.
  - Another tenant's referral id returns 404, with no change.
  - `sort=random` returns 400 INVALID_SORT.
- **Compliance bulk.**
  - Empty ids, more than 500 ids, or a missing reason: 400.
  - One id from another tenant: 404 and no rows changed. Assert the tenant A rows are unchanged.
  - Without the manage permission: 403.
  - A concurrent PATCH on the same row serializes; there is no lost update.
- **AI audit.** Negative offset, or limit over the maximum: 400. Filters never return another tenant's rows.
- **Nav counts.** A failed count request hides the badge, and the link still works. No count request is made without permission.
- **Dialogs.**
  - Cancel and Escape send no request.
  - A double submit sends one request: the button is disabled while pending.
  - A server error keeps the dialog open with the message.
- **Wizard.** Changing the product after the company is chosen clears incompatible company and agency selections with a notice.

## Regression cases

- **Existing suites must pass unchanged in intent:**
  - E2E specs: quote-wizard, policy-lifecycle, policy-documents, transaction-documents, forms-management, uw-referrals, submission-intake, role-access-matrix, collapsible-sections, ui-section-standards, customer-portal.
  - Every unit and integration suite.
  - The pilot workflow.
- **Selector updates allowed, outcomes the same:**
  - e2e helpers that call `/approve` or `/decline` without a reason now send one.
  - Selectors for Approve buttons move to the detail view.
  - Date assertions use the new US format.
- **Standards tests remain green:** radio-standard, collapsible sections, plus the new design-tokens and native-dialogs tests.
- **Document, rating and transaction outputs are unchanged.** Spot-check: the policy packet hash for a fixed fixture is unchanged, and premium totals match before and after.
- **Phone width:** a 390px pass over dashboard, search, policy, wizard, submissions and referrals.
