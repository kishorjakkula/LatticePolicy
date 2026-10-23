# UI Design - WP-0005

Status: proposed for Gate B; mockup is not the running application.

## Journeys And Screens

Agents and underwriters edit an address in the existing customer/insured,
quote or servicing context, optionally check, review the suggestion and save
through the existing action. Carrier admins edit customer master addresses in
the existing Contact & Address section. Read-only users see formatted addresses
only. Customer portal projections stay customer-safe with no new editing route.

| Existing surface | Change | Requirements |
| --- | --- | --- |
| Customers > Contact & Address | Retain current screen/tabs/contact fields/address table; selected address opens shared fields inline | 1-3,5,8,10 |
| Insureds, wizard primary/secondary/additional insured and other contact editors | Multiple addresses per contact, same shared fields and complete customer mappings | 1-3,8,10 |
| Wizard Mailing Address | Same editor; copy retains unit/country/ZIP+4 and invalidates old checks | 1-3,5 |
| Wizard Additional interests | Same editor beneath existing party/loan fields | 1-3 |
| Dwelling risk, vehicle garaging and legacy quote | Single embedded address per risk/vehicle, preserved legacy data; no address-list controls | 1-3,8,10 |
| Policy/customer summaries and documents | Format full address without adding edit controls | 3,8 |
| Every eligible editable address | Explicit disclosure, Check Address and inline comparison | 4-7,9 |

No new top-level navigation or address management application.
Preserve existing surrounding fields, tabs and Save/Cancel actions. No separate
Save Address page or unrelated screen redesign. Read-only contact popups stay
read-only; edits use existing authorized edit paths.

## Layout

See revised `mockups/address-entry.html` for the address control embedded in
an existing Contact & Address layout and single-risk/garaging contexts.

```text
Contact & Address (existing contact screen)
Contact details: name / email / phone (unchanged)
Addresses                                             [Add Address]
Type       Address                         Primary    Actions
Mailing    10 Test Street, APT 4B ...       Yes        Edit / Remove
Business   20 Example Avenue, STE 200 ...   No         Edit / Set primary / Remove

Selected address (inline, below existing table)
Type [Mailing v]
Country [United States v]
Address line 1 [____________________________________________]
Apartment, suite or unit [__________________________________]
City [___________________] State [TX v] ZIP Code [__________]
County (where relevant) [___________________]
[ ] I agree to send this street, city, state and ZIP to Census.
[Check Address]

Address match found. Apartment/unit was not checked.
Entered address                 Suggested address
...                             ...
[Keep entered address]          [Use suggested address]

Existing page footer: [Cancel] [Save Changes]

Risk Details / Vehicle Details (existing section)
Risk address / Garaging address: ONE set of shared address fields
No Add Address table or contact-address collection here
```

Use `CollapsibleSection`, `FieldError`, `StatusBadge`, `Checkbox` and existing
buttons/tokens; a small shared `AddressFields` component removes repeated
incomplete editors. No nested decorative cards. Existing address type, primary,
effective dates and delete controls remain adjacent, not sent to the provider.

Contact rows support Add/Edit/Remove and one explicit primary, independently
for each contact. New rows become editable inline; removing the primary visibly
selects a remaining primary before Save. Empty lists show No addresses. Copying
from a contact with multiple addresses offers a choice (default primary), never
silently uses the first row. Validation and check feedback belong to that row;
switching contacts/rows invalidates pending suggestions. Other address slots
remain single-valued; several vehicles do not mean several addresses per vehicle.

## States And Wording

- Empty: all entry fields usable; local format guidance, not false certification.
- Disabled provider: editor remains usable; no consent/check control, neutral
  "External address checking is disabled" where status is displayed.
- Enabled: unchecked recipient disclosure; Check disabled until explicitly
  authorized and enough structured input exists. No outbound calls from typing.
- Checking: "Checking address...", one pending request, edits still possible
  but invalidate it. No page-wide loading blocker.
- Match: "Address range matched. Postal delivery and unit were not verified."
- Ambiguous: candidate selection as an accessible RadioGroup; choose before
  Apply. Do not auto-select the first candidate.
- Unmatched: "No address match found. You can keep the address you entered."
- Unsupported: "This address type cannot be checked with this service."
- Unavailable: "Address check unavailable. Your entries have been kept."
- Provider/permission errors announced without exposing upstream details.
- Editing/copying/resetting clears suggestion/status and consent. A suggested
  correction changes only the draft; existing Save/rate/bind remains explicit.
- Read-only: no change, disclosure or provider call; show full formatted address.
- Missing/long/legacy values wrap; never truncate apartment or postal details.

## Accessibility And Responsive Behavior

Visible labels, unique IDs per repeated address and section-scoped autocomplete
tokens (`address-line1`, `address-line2`, `address-level2`, `address-level1`,
`postal-code`, `country`). ZIP is text, not number. Country/state are selects;
non-US state/province supports existing values. Requiredness comes from the
carrier rules, not a universal hardcoded mandatory-country policy.

Keyboard order follows visual order; check results use a polite live region,
malformed fields use FieldError/alert. Applying a suggestion returns focus to
the address editor/result; Keep preserves entered fields. All focus indicators
and contrast use existing light/dark tokens, with no color-only statuses.

Desktop uses a constrained form with city/state/ZIP on one row, two comparison
columns. At 390px all fields and comparisons stack, actions wrap, labels never
overlap and no horizontal page scrolling occurs. Test keyboard, 200% zoom,
long names/units and reduced motion. Register affected routes in the UI audit.

## Requirement Mapping

REQ-1/2: labelled country-aware editor; REQ-3: complete summaries/copy;
REQ-4: range-match status; REQ-5: explicit comparison/Apply/Keep;
REQ-6: consent/disabled state; REQ-7: nonblocking feedback;
REQ-8: read-only and carrier field messages; REQ-9: responsive UI audit.
REQ-10: contact address table + inline editor embedded in existing screen;
single-value risk/garaging/mailing sections.

## Earlier Mockup Verification (Superseded Layout)

Headless Chromium at 1440px and 390px confirmed no horizontal page overflow.
Mockup interactions passed: consent gating, comparison display, applying a
suggestion preserves APT 4B, copying retains 02108-1234, changes invalidate
results, and unavailable service retains entries. Mobile screenshot inspected.
This is synthetic mockup evidence only, not application integration testing.
The mockup state selector and limited sample state options are preview controls,
not the production state catalog. No network requests or records are written.

## Revised Embedded Mockup Verification

Chromium verified contact Add/Edit/Remove, three independent address rows,
single-primary reassignment after removal, apartment preservation after Apply,
and leading-zero ZIP+4 round-trip while switching rows. Risk and garaging
contexts expose exactly one address editor and no visible Add Address action.
All three contexts fit 1440px and 390px without horizontal page overflow; the
contact table scrolls within its own region. Desktop contact and mobile
garaging screenshots inspected; no script errors. This supersedes the earlier
standalone layout and remains synthetic design evidence, not deployed code.

## Running Application Review

Existing customer edit and vehicle garaging widgets now have browser checks
at 1440px/390px in both themes, scoped WCAG A/AA scans and page/table bounds.
Actual desktop dark contact, mobile light contact and mobile dark garaging
screenshots were inspected under `output/wp-0005-browser/` (local-only output).
Scoped styles corrected dark contrast, label contrast and mobile clipping
caused by the existing automatic table-card transformation. Actions now wrap
with spacing. The collection stays in Contact & Address; no new navigation or
address-management screen. Email/mobile remain in the existing contact area.
See 09 for repeat evidence. Not a Docker application deployment or carrier UAT.
