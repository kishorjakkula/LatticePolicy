# UI design — WP-0004

Built on the existing design system (`CollapsibleSection`, `RadioGroup`,
`StatusBadge`, `TablePagination`, `EmptyState`, `Toast`, `--ps-*` tokens). Evidence:
the review screenshots of 2026-10-20 and the "LatticePolicy UI and Flow Review" doc.

## User journeys

- **Agent: new business.**
  1. Home ("My work") or Policies > New quote.
  2. Product, state, effective date and term.
  3. Company and agency.
  4. Qualification, insureds, risk, coverages.
  5. Rating, then premium and billing.
  6. Forms & documents, then bind.
  7. Ends on the policy page, whose header names the insured.
- **Agent: servicing.**
  1. Quick lookup or Policies.
  2. The policy page shows insured, product, current term, premium and status; actions show only those that apply.
  3. Ends on the transaction's Forms & documents.
- **Underwriter: referral.**
  1. Work > Referrals, with a count; the list is oldest first.
  2. Open a referral.
  3. Reasons, key exposures and premium show first.
  4. Approve, Decline or Request info, with a required reason in a dialog.
  5. Ends back on the list with a toast and the count updated.
- **Underwriter: submission.**
  1. Work > Submissions, then a submission.
  2. Review opens on "Needs attention".
  3. Confirm values.
  4. Continue to approval.
- **Carrier admin.** Admin home (needs attention) > a grouped menu item, e.g. Products & rules > Compliance.
  - The grid is filtered to a product; select states, Change status, enter a reason, confirm.
- **Policyholder.** No change (portal out of scope).

## Screens

| Screen | New / changed | Where in navigation | Requirements |
| --- | --- | --- | --- |
| App header | Changed | Global | REQ-5, REQ-6, REQ-15 |
| Home (dashboard) | Changed | Home | REQ-11 |
| UW referral list | Changed | Work > Referrals | REQ-1, REQ-17 |
| UW referral detail | Changed (decision panel) | Work > Referrals > item | REQ-1 |
| Reason / confirm dialog | New component | Any decision | REQ-2 |
| Policy page | Changed | Policies > item | REQ-3, REQ-4, REQ-12 |
| Policy search | Changed | Policies | REQ-13, REQ-14 |
| New quote wizard step 1 + Premium step | Changed | Policies > New quote | REQ-8 |
| Submission review | Changed | Work > Submissions > item | REQ-9 |
| Admin home + grouped menu | New + changed | Admin | REQ-5 |
| Compliance grid | Changed | Admin > Products & rules | REQ-10 |
| Security matrix | Changed | Admin > Platform | REQ-10 |
| AI audit | Changed | Admin > Platform | REQ-19 |
| Forms list | Changed | Admin > Products & rules | REQ-18 |

## Layout

App header:

```text
[Carrier logo] Home  Work ▾(Submissions 3 · Referrals 4 · Placements)  Policies  Customers  Rating  Admin   [Quick lookup…] [user ▾]
```

Policy page header (replaces the "Customer -" card):

```text
Policies / PC-47C2347B
Daniel Kim ↗            Personal Auto · Term 09/18/2027–09/18/2028            [In force]
Premium this term $542.82        As of [09/18/2027 ▾]
Actions: [Endorse] [Renew] [Non-renew]                             [Cancel policy]  (danger, last)
```

Referral list and detail:

```text
Referrals (Open ▾)                                            sorted: oldest first
| Age | Insured      | Product      | Premium | Reasons                       | Assigned   |        |
| 5d  | Daniel Kim   | Homeowners   | $775.21 | Roof age 20-30                | [Assign me]| [Open] |

Detail: ┌ Why this was referred ─────────────┐ ┌ Decision ───────────────────────┐
        │ • Roof age 20–30 (refer)          │ │ [Approve] [Decline] [Request info]│
        │ Key exposures · premium · limits  │ │ Authority: within your limit     │
        └───────────────────────────────────┘ └──────────────────────────────────┘
```

Reason dialog:

```text
┌ Approve referral HO-F44BE73E ───────────────┐
│ Reason (required)                            │
│ [                                          ] │
│ Shown in the referral history.               │
│                         [Cancel] [Approve]   │
└──────────────────────────────────────────────┘
```

Wizard step 1 ("Product & term"), in this order:

```text
Product & term:  Country · State · Product · Effective date · Term · Policy offering
Company & agency: Underwriting company · Agency · Agency contact · Commission %   (role-dependent)
Prior insurance:  (unchanged fields)
```

- Billing moves to step 7 (Premium) under "Payment".
- The dot progress row is removed; the left stepper remains.

Home:

```text
My work: [Open quotes 59] [Referrals 4] [Submissions to review 3] [Renewals due 0]   (cards link to filtered lists)
Portfolio (collapsed by default on phones): counts, status distribution, product mix, trend
```

Compliance grid:

```text
Product [Homeowners ▾]  Show [Exceptions only ▢]     [Change status…] (enabled when rows selected)
| ▢ | State | Status   | Filing ref | Effective | Updated   |
| ▢ | CA    | Active   | CA-HO-2024 | 01/01/2024| 10/18/2026|
```

Security matrix: role columns × permission rows, grouped by area (Policies,
Underwriting, Rating, Administration, AI, Portal) with a search box; each cell is a
named checkbox ("Underwriter: approve referrals").

## Components

- **New `ReasonDialog` and `ConfirmDialog`:** there is no modal component today, and 29 native dialogs need replacing.
- **New `PageHeader`:** gives policy, referral and submission headers one place for identity, status and the primary action.
- **New `AppNav`:** the nav model with permission filtering and counts, extracted from `App.tsx`.
- **Reused:** `TablePagination` everywhere (the other pager is retired); `StatusBadge` with the new legend tooltip; `CollapsibleSection`; `EmptyState`; `Toast`; `RadioGroup`; `FieldError`.

## States

- **Empty.**
  - Referrals: "No open referrals. Referred quotes appear here."
  - Compliance filter with no exceptions: "Every state is active for Homeowners."
  - Home cards show 0 and still link.
- **Loading.** Skeleton rows in tables. Nav counts show nothing until loaded, never "0" by default.
- **Error.** Inline banner with Retry. If a nav count fails, the count is hidden; the link remains.
- **Validation.**
  - The dialog reason is required: "Enter a reason", announced, with focus on the field.
  - Bulk compliance: "Select at least one state."
- **Read-only and permission-denied.**
  - Actions without permission are not shown.
  - An unavailable action shows its reason, e.g. "Only a cancelled policy can be reinstated."
  - Referral decision without authority: "Above your authority limit. Request an override."
- **Long or missing data.**
  - Insured names truncate with a full-text tooltip.
  - No linked insured: "No insured linked".
  - A missing premium shows "Not rated".

## Wording

- **Buttons:** "Open", "Approve", "Decline", "Request info", "Assign to me", "Cancel policy", "Change status…", "Accept 12 high-confidence values".
- **Document names:** "Policy packet — Renewal", "Rating worksheet — New business".
- **Transaction types:** New business, Endorsement, Cancellation, Reinstatement, Renewal, Rewrite, Non-renewal.
- **Status legend:**
  - Bound: coverage bound, documents not yet issued.
  - Issued: documents issued, term not yet started.
  - In force: issued and the current term has started.
  - Expired / Cancelled: no coverage now.
- **Confirmations:**
  - "Cancel policy PC-47C2347B effective 11/01/2026? Refund: pro rata."
  - "Change 10 states to Inactive for Homeowners?"

## Accessibility

- **Dialogs:** focus moves to the first field and is trapped; Escape cancels; focus returns to the trigger; the title is the accessible name; errors use `role="alert"`.
- **Tab order:** header, then page actions, then content. Header menus are buttons with `aria-expanded`.
- **Matrix and grid checkboxes:** named "<role>: <permission>" and "<state>: select".
- **Icon-only buttons:** `aria-label` plus a tooltip on hover and focus.
- **Contrast:** 4.5:1 for text and 3:1 for controls, verified with an axe check in Playwright on in-scope screens; the grey label token is darkened.
- **Targets and motion:** targets are at least 24×24px; motion respects `prefers-reduced-motion`.

## Responsive behavior

- **Header at 390px:** a menu button opens a sheet with the same groups and counts.
- **Tables at 390px:**
  - Policy transactions, search results, referrals and submissions become cards with 3–4 key fields and "Details".
  - Admin grids keep a table inside a horizontal scroll container; the page never scrolls sideways.
- **Search filters:** collapse into a "Filters" sheet.
- **Pager:** one row (Prev · page x of y · Next); the page-size picker moves into "Details".
- **Wizard:** the stepper becomes a "Step 1 of 8: Product & term" bar with a step list sheet.

## Requirement mapping

| Requirement | UI elements |
| --- | --- |
| REQ-1 | Referral list "Open" only; detail decision panel; reason dialog |
| REQ-2 | ReasonDialog / ConfirmDialog in every decision |
| REQ-3 | Policy PageHeader with insured link, product, term, premium, as-of |
| REQ-4 | Display names; version IDs under Details |
| REQ-5 | Header with Work menu and counts; Customers; grouped Admin and admin home |
| REQ-6 | One primary per group; Cancel policy last in danger style; one pager and disclosure |
| REQ-7 | MM/DD/YYYY everywhere for US |
| REQ-8 | Product & term first; billing in Premium; stepper only; header summary |
| REQ-9 | Needs attention default; group "found of total"; short placeholders; counted bulk accept |
| REQ-10 | Compliance grid with bulk change; Security matrix |
| REQ-11 | My work cards; zero bars; future forecast; refresh time; axis labels |
| REQ-12 | Action availability reasons; trimmed transaction columns; table sort arrows |
| REQ-13 | Search page-size, headers, product names, status legend, full-text selects |
| REQ-14 | Phone cards, scroll containers, compact pager, filter sheet |
| REQ-15 | Accessible names, tooltips, contrast, targets |
| REQ-16 | Token colours only |
| REQ-17 | Age, insured, product, premium, assignee columns; oldest first; Assign to me |
| REQ-18 | Forms list no-wrap, View/Edit labels, "All states" wording |
| REQ-19 | AI audit filters, paging, side panel |
