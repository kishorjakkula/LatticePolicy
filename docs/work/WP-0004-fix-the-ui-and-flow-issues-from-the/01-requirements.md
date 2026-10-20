# Requirements — WP-0004

Source: the UI and flow review of 2026-10-20 (32 desktop and 6 phone-width
screens of the local build, plus the frontend code). Knowledge bases are current:
P&C (reviewed 2026-10-17, 90 days) and UX (2026-10-18, 180 days).

## Business goal

Agents, underwriters and carrier administrators spend less time finding work and
interpreting screens, and contractual decisions (referral approval, cancellation,
compliance changes) are always taken with the evidence in view and a recorded
reason. The application should read as one product: one primary action style,
one date format, plain names instead of system codes, and layouts that work on
a phone without sideways scrolling.

## Scope

- Lines of business: all installed products (personal auto, homeowners,
  commercial auto, cyber, professional liability); presentation only.
- States / jurisdictions: all; no state-specific behavior changes.
- Transactions: new business quote/bind/issue, endorsement, cancellation,
  reinstatement, renewal, rewrite and non-renewal screens (presentation, flow
  order and confirmation dialogs only; no change to rating or transaction rules).
- Roles and channels: agents and underwriters (internal web app), carrier and
  compliance administrators (Administration). The customer portal is out of scope.

## Requirements

| ID | Requirement | Source |
| --- | --- | --- |
| REQ-1 | Underwriting referrals are approved or declined only from the referral's detail view, which shows the referral reasons first and requires a reason; the list offers a single "Open" action. | Product decision; UX knowledge base (decision and reasons first) |
| REQ-2 | Every action that asks for a reason or confirmation (currently 18 `prompt()` and 11 `confirm()` uses) uses an in-app dialog with a labelled field, inline validation, focus trap and focus return. | WCAG 2.2 AA (UX knowledge base) |
| REQ-3 | The policy page header shows named insured (linked to the customer), product display name, current term dates, status and current-term premium, plus an "as of" date control. | Product decision |
| REQ-4 | Product, transaction and document types are shown by display name everywhere a user reads them (e.g. "Policy packet", "Renewal", "Personal Auto"); internal IDs such as version UUIDs appear only in an expandable details area. | Product decision |
| REQ-5 | Navigation exposes daily work: a Work area (Submissions, Referrals with an open count, Placements), Customers, Policies; the Administration menu is grouped (Products & Rules, Partners, Operations, Platform) with an admin home; prototype wireframe routes are removed from the app. | Product decision |
| REQ-6 | One primary button style per screen from the design tokens; destructive actions use the danger style and sit last in their group; one pagination component and one section disclosure style across screens. | UX knowledge base (tokens, components) |
| REQ-7 | Dates display in one format per locale (US: MM/DD/YYYY; date-times MM/DD/YYYY h:mm AM/PM), and date inputs match it. | Product decision |
| REQ-8 | New quote wizard step 1 collects product, state, effective date and term first; company, agency and commission follow; billing is collected at premium/bind; one progress indicator; the header shows a quote summary instead of repeating the effective date. | Insurance UX convention (UX knowledge base); product decision |
| REQ-9 | Submission review opens on "Needs attention", shows a found/total summary per group, uses short placeholders, and "Accept all high confidence" states how many values it will accept before accepting. | Product decision; AI proposals stay marked until confirmed (SUBMISSION_INTAKE) |
| REQ-10 | Compliance eligibility is edited as a product × state grid with filters and bulk change (reason required, audited); Security permissions are shown as a role × permission matrix grouped by area, in sentence case, with search. | Product decision; audit rules (existing) |
| REQ-11 | The dashboard leads with "My work" (open quotes, open referrals, submissions to review, renewals due); bars start at zero length for zero values; forecasts appear only for future months; the chart axis labels do not overlap; "Last refreshed" shows a time. | Product decision |
| REQ-12 | Policy actions that do not apply are hidden or explain why they are unavailable; the transactions table shows one column per date meaning and drops low-value columns; sort indicators come from the table component. | Product decision |
| REQ-13 | Search results show the page size actually used, headers never overlap, product names replace codes, statuses have a legend, and select controls show their full text. | Defects found in review |
| REQ-14 | No screen scrolls horizontally at 390px (WCAG 1.4.10); transaction and search results use compact cards on phones; pagers fit one row; search filters collapse. | WCAG 2.2 AA |
| REQ-15 | Icon-only buttons have an accessible name and visible tooltip; text and controls meet 4.5:1 / 3:1 contrast; interactive targets are at least 24×24px. | WCAG 2.2 AA (1.4.3, 1.4.11, 2.5.8) |
| REQ-16 | Feature and component code uses colour tokens only; a lint check fails new hard-coded colours. | UX knowledge base (tokens) |
| REQ-17 | The referral queue shows insured name, product, premium, referral age and assignee; sorts oldest first by default; allows assignment; and has no "New Quote" action. | Product decision |
| REQ-18 | Forms administration shows form numbers without wrapping, labelled row actions, and scope text that states what applies ("All states") rather than what is missing. | Product decision |
| REQ-19 | The AI audit trail is paginated and filterable by model, user and date, with detail in a side panel. | Product decision |

## Acceptance criteria

### REQ-1

```gherkin
Scenario: No decision from the referral list
  Given an open referral in the UW Referrals list
  Then its row offers "Open" and no Approve or Decline button

Scenario: Decision requires a reason
  Given an underwriter viewing an open referral's detail
  When they choose Approve without entering a reason
  Then the decision is not sent and the reason field shows "Enter a reason"

Scenario: Authority still enforced
  Given an underwriter without authority for the referral
  When they open it
  Then Approve is unavailable with the reason shown, and the server still refuses a direct request
```

### REQ-2

```gherkin
Scenario: Reason dialog replaces the browser prompt
  Given any action that needs a reason (form approval, user deactivation, compliance change, placement transition, customer change, referral decision)
  When the user starts it
  Then an in-app dialog opens with a labelled reason field, focus inside it, and Escape cancels without changing anything

Scenario: No native dialogs remain
  When the frontend source is checked
  Then it contains no window.prompt, prompt( or confirm( calls
```

### REQ-3

```gherkin
Scenario: Policy header identifies the policy
  Given an issued personal auto policy with a named insured
  When the policy page opens
  Then the header shows the insured name linked to the customer, "Personal Auto", the current term dates, the status and that term's premium

Scenario: Missing insured is explicit
  Given a policy with no linked customer
  Then the header shows "No insured linked" rather than "-"
```

### REQ-4

```gherkin
Scenario: Documents read as names
  Given a policy with a renewal packet
  Then the documents list shows "Policy packet — Renewal" and type "PDF", not POLICY_PACKET or RENEW
  And the version ID is shown only after expanding "Details"
```

### REQ-5

```gherkin
Scenario: Referrals reachable from navigation
  Given an underwriter with referral permission and 4 open referrals
  Then the header shows Work > Referrals with a count of 4

Scenario: Grouped administration
  When an administrator opens Administration
  Then an admin home lists items needing attention and the menu shows four named groups

Scenario: Prototypes not reachable
  When a user visits /wizard-wireframes or /header-wireframes
  Then the not-found page is shown

Scenario: Permissions still respected
  Given a user without referral permission
  Then Referrals does not appear in the navigation
```

### REQ-6

```gherkin
Scenario: One primary action
  Given any screen in scope
  Then at most one button per action group uses the primary style, and it uses the primary token colour
  And Cancel Policy appears last among policy actions in the danger style
```

### REQ-7

```gherkin
Scenario: US date display
  Given a US tenant
  Then dates read MM/DD/YYYY on dashboard, search, policy and wizard screens, and date-times include AM/PM
```

### REQ-8

```gherkin
Scenario: Product first
  Given a new quote
  Then the first fields are product, state, effective date and term, and billing is not asked in step 1

Scenario: Existing quotes still open
  Given a draft quote saved before this change
  When it is reopened
  Then all its saved values, including billing, are shown in their new steps
```

### REQ-9

```gherkin
Scenario: Review starts on what needs attention
  Given a submission with 54 values not found
  When review opens
  Then "Needs attention" is selected and each group shows "found of total"

Scenario: Bulk accept states its effect
  When the reviewer chooses "Accept all high confidence"
  Then the dialog states how many values will be accepted before anything changes
```

### REQ-10

```gherkin
Scenario: Bulk compliance change is audited
  Given a compliance admin selects 10 states for Homeowners
  When they set status Inactive with a reason
  Then all 10 rows change, one audit entry per row records the reason, and a missing reason blocks the change
```

### REQ-11

```gherkin
Scenario: Zero shows as zero
  Given no Draft policies
  Then the Draft bar has no filled length

Scenario: Forecast only ahead
  Then forecast values appear only for months after the current month
```

### REQ-12

```gherkin
Scenario: Unavailable action explains itself
  Given an in-force policy
  Then Reinstate is not offered, or its unavailable state says "Only a cancelled policy can be reinstated"
```

### REQ-13

```gherkin
Scenario: Page size matches
  Given 183 policies and page size 20
  Then the picker shows 20 and the pager shows "Page 1 of 10"
```

### REQ-14

```gherkin
Scenario: No sideways scroll on phones
  Given a 390px-wide viewport
  When each in-scope screen is opened
  Then the page's scroll width equals the viewport width
```

### REQ-15

```gherkin
Scenario: Icon buttons are named
  Then every icon-only button has an accessible name and a tooltip, and an automated accessibility check reports no contrast or name violations on in-scope screens
```

### REQ-16

```gherkin
Scenario: Hard-coded colours rejected
  When a feature file introduces "#3a5fcd"
  Then the lint check fails with a message pointing to the tokens
```

### REQ-17

```gherkin
Scenario: Triage columns
  Given open referrals of different ages
  Then the list shows insured, product, premium, age and assignee, oldest first, and an underwriter can assign one to themselves
```

### REQ-18

```gherkin
Scenario: Form list readability
  Then "HO-BINDER" fits on one line, row actions read "View" and "Edit", and an unscoped form reads "All states"
```

### REQ-19

```gherkin
Scenario: AI audit filtering
  Given 500 AI audit entries
  Then the trail shows 25 per page and can be filtered by model, user and date range
```

## Business rules

- Underwriting decisions keep their existing server-side authority checks and audit
  records; the UI change must not add a path that bypasses them (existing rule,
  `uw-referral.service.ts`).
- A reason is required for referral decisions, compliance eligibility changes,
  form workflow transitions and user deactivation (existing server rules; the
  dialog makes them visible before submit).
- Status vocabulary is unchanged; the legend explains it (In Force = issued and
  the current term has started).

## Regulatory and compliance notes

- No change to rates, filed forms, notices, notice periods or transaction rules.
- Underwriting and compliance decisions remain audited with actor, time and reason.
- Accessibility target: WCAG 2.2 AA (UX knowledge base).
- Customer portal content is unchanged.

## Out of scope and assumptions

- Out of scope: customer portal redesign; new reports; changes to rating,
  underwriting rules or transaction logic; brand redesign.
- Assumption: delivered in three pull requests under this work package
  (quick wins; workflow fixes; restructure), each passing all gates' checks.
- Assumption: the WP-0003 forms changes (PR #391) merge first; this work builds on them.

## Questions and answers

| # | Question | Recommended default | Answer |
| --- | --- | --- | --- |
| 1 | Who may approve or decline a referral in the new detail view? | Unchanged: existing UW authority and permissions | |
| 2 | Date format? | Country-aware formatter; US = MM/DD/YYYY, 12-hour time | |
| 3 | Merge "Issued" and "In Force" statuses? | No; keep both and add a legend | |
| 4 | Which roles need full phone support? | Agents and underwriters (dashboard, search, policy, wizard, submissions, referrals); admin screens only need no sideways scroll | |
| 5 | Delivery shape? | One work package, three pull requests by phase | |
| 6 | Customer portal? | Out of scope; separate review needing a customer login | |
| 7 | Hard-coded colour lint: warning or error? | Error for new code; fix existing uses in this package | |
| 8 | Bulk compliance changes: one reason for the batch? | One reason, recorded on every changed row | |
