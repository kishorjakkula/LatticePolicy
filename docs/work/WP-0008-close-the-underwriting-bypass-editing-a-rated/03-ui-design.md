# UI design — WP-0008

Small change inside the existing new-quote wizard; no new screens.

## User journeys

Agent:
1. Rates the quote.
2. Goes back and changes a driver's age.
3. Returns to Premium.

The Premium step shows "Your changes need a new rating" with Rate again, and Bind is not
offered until the quote is rated. After Rate again, the new premium and underwriting result
show, and Bind is offered (or the bind is referred).

## Screens

| Screen | Change | Where |
| --- | --- | --- |
| New quote wizard, Premium step (7) | Re-rate notice when the rating was reset | Policies > New quote |
| New quote wizard, Forms & documents step (8) | Bind refused with 409: same notice and a link back to Premium | Policies > New quote |

## Layout

```text
Premium
┌ Your changes need a new rating ───────────────────────────────┐
│ Risk details changed after this quote was rated. Rate it again │
│ to see the premium and underwriting result.      [Rate again]  │
└────────────────────────────────────────────────────────────────┘
Payment: Billing method · Payment plan   (still editable; does not need a new rating)
```

## Components

Existing banner/alert style (`role="status"` notice), existing Rate action and button
styles. No new component.

## States

- **Rated, unchanged:** the premium shows and Bind is available, as today.
- **Rating reset:** the notice shows, the premium is hidden and Bind is not offered.
- **Billing-only change:** no notice, and the rating stays.
- **Bind 409:** the notice shows on step 8, with "Go to Premium".
- **Error while re-rating:** the existing rating error message.

## Wording

- Title: "Your changes need a new rating".
- Body: "Risk details changed after this quote was rated. Rate it again to see the premium and underwriting result."
- Button: "Rate again".
- Step 8: "This quote changed after it was rated." with the link "Go to Premium".

## Accessibility

- The notice is a `role="status"` region, announced once when it appears.
- Rate again is a real button that is first in tab order within the notice.
- No colour-only meaning: the text states the condition.

## Responsive behavior

The notice wraps at 390px; Rate again goes full width below the text.

## Requirement mapping

| Requirement | UI element |
| --- | --- |
| REQ-1 | Notice shown when the draft save reports `ratingReset` |
| REQ-2 | None visible; the wizard never sends lifecycle statuses except the post-issue audit |
| REQ-3 | Step 8 bind 409 notice with "Go to Premium" |
| REQ-4 | Payment section edits do not show the notice |
| REQ-5 | "Rate again" in the notice |
