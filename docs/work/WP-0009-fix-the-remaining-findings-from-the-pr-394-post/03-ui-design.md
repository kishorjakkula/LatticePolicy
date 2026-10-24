# UI design — WP-0009

Small changes on existing screens; no new screens.

## User journeys

- **Underwriter.**
  1. Work > Referrals: the Premium column shows the proposal's premium.
  2. Opening a referral shows "Earlier decisions on this proposal" when there are any.
  3. Approving their own referral shows "You submitted this referral. Another underwriter must approve it."
- **Compliance admin.** Editing a single eligibility status asks for a reason in the existing reason dialog.
- **Agent.** Rating or binding with an underwriting company that does not write the product in the state shows the server message under the company field. Binding an expired quote shows "This quote has expired. Rate it again to continue."
- **Phone user.** The menu opens with focus inside the sheet; Escape closes it.

## Screens

| Screen | Change |
| --- | --- |
| Referral list | Premium column source; legacy items no longer listed as Open |
| Referral detail | "Earlier decisions on this proposal" section; self-approval message |
| Compliance eligibility edit | Reason dialog on a single status change |
| Quote wizard | Company eligibility error on the company field; expired-quote message at bind |
| App navigation (phone) | Sheet focus and Escape behaviour |

## Layout

```text
Referral detail
  Why this was referred …
  Earlier decisions on this proposal
    Declined 10/21/2026 by J. Smith — "Prior losses not explained"
  Decision: [Approve] [Decline] [Request info]
    (own referral) Approve disabled — "You submitted this referral. Another underwriter must approve it."
```

## Components

Existing `ReasonDialog`, `PageHeader` facts, `EmptyState`, `RerateNotice`-style status
message; no new component.

## States

- No earlier decisions: the section is hidden.
- Self-approval: Approve is disabled with the reason; Decline and Request info stay available.
- Company not eligible: an inline error under Underwriting company with the server message; the user picks another company.
- Expired: a status message at bind with "Rate again".

## Wording

- "Earlier decisions on this proposal".
- "You submitted this referral. Another underwriter must approve it."
- "This underwriting company does not write {product} in {state}."
- "This quote has expired. Rate it again to continue."

## Accessibility

- The self-approval reason is linked to the disabled button (`aria-describedby`).
- The phone sheet moves focus to its first link on open; Escape closes it and returns focus to the menu button.
- Messages use `role="status"`, or `role="alert"` for errors.

## Responsive behavior

All changes reuse existing layouts and wrap at 390px.

## Requirement mapping

| Requirement | UI element |
| --- | --- |
| REQ-1 | Premium column |
| REQ-2 | None visible (approvals no longer expire) |
| REQ-3 | None (docs) |
| REQ-4 | Reason dialog on single eligibility change |
| REQ-5 | Company field error |
| REQ-6 | Earlier decisions section; self-approval message |
| REQ-7 | Legacy referrals leave the Open list and count |
| REQ-8 | Phone sheet focus and Escape |
| REQ-9 | None visible |
| REQ-10 | None visible (400 shown in the dialog) |
| REQ-11 | Expired message at bind |
