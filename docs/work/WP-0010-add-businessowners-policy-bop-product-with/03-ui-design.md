# UI Design - WP-0010

Proposed Gate B design. Embed BOP into existing screens; no new product console.

## Journeys and screens

| Screen | Change | Requirements |
| --- | --- | --- |
| Submissions / review | Select BOP; upload application; review source-backed business/location/coverage values and derived package terms | REQ-1,2,3,4,8 |
| Existing quote wizard: policy/insured | BOP and eligible company/agency, term/state, current contact and address controls | REQ-1,4,7 |
| Existing quote wizard: risk | Business, premises and protections groups with configured checks | REQ-4,6 |
| Existing quote wizard: coverage | Required package and conditional building, editable allowed limits/deductibles; optional extensions | REQ-2,3 |
| Existing quote wizard: review/rate/bind | Component premiums, included sublimits/income terms, referrals and existing authorization gates | REQ-5,6 |
| Policy transaction detail | BOP risk/coverage summaries and transaction-level Forms & Documents | REQ-9 |
| Existing administration | BOP entries in eligibility, companies, agency/producer, validation/UW and form configuration | REQ-6,7,9 |

## Embedded layout

Existing Risk step, inside current page:
```text
Business
Business class [Office v]   Annual sales [$750000]
Employees [5]              Years in business [6]
Prior losses [0]           Prior loss amount [$0]

Premises
Occupancy [Tenant v]       [existing single AddressFields]
Construction [Masonry v]   Building year [2015]
Floor area [2500]          Roof age [5]
Protection class [3]       Vacancy days [0]
[ ] Sprinklers   [x] Fire alarm   [ ] Hazardous operations

Existing Checks panel / Back / Continue
```

Coverage step uses current coverage rows, not nested cards:
```text
Coverage                         Limit       Deductible
Building [owner/interest only]   optional       $1000
Business personal property       $100000       $1000
Business income + extra expense  $100000       included terms
Business liability              $1000000       package
Medical expenses                   $5000       included
[ ] Equipment breakdown
[ ] Water backup
```
Display liability aggregates, rented-premises/personal-injury sublimits, income
waiting/restoration period immediately beneath the relevant coverage row and in
Review/Documents. Included is not the same as a separate zero-cost insurance
product. Required package items cannot be silently deselected; API rejects bypass.
Owner-to-tenant edits explicitly require review of building selections; do not
silently erase previously selected coverage. No multi-location Add button.

## Components and wording

Use existing wizard field renderers, AddressFields, Select, shared RadioGroup
only where radio choices are needed, Checkbox for booleans, money/number inputs,
existing coverage tables, validation and referral panels. Maintain current
navigation and visual tokens; no new decorative cards or large hero content.
Labels include "Businessowners Policy (BOP)", "Business class", "Occupancy",
"Business income and extra expense", "General aggregate", "Included".
A restrained "Demo - not a contract of insurance" label belongs on demo
outputs/sample records. No in-app technical explanations or feature-tour copy.

## States, access and accessibility

Loading uses existing stable skeleton/field dimensions. No eligible company/
agency shows a specific empty state with admin navigation only for authorized
users; do not pick a company from another state/tenant. Errors preserve inputs
and identify fields. Referrals/declines use existing workflow. Read-only
historical views retain pinned terms and disable edits. Permission denial is
distinct from empty data. Long company/address names wrap without overlap.
Tab order follows visible groups; every input has an accessible name; required
checks and errors link to fields and announce updates. Existing dialogs trap
focus/return it; no color-only state. Avoid new animation.

Desktop uses existing compact two-column risk groups and coverage table.
At 390px groups become one column and coverage rows wrap into existing responsive
layout; action labels stay visible, no page overflow or clipped addresses.
Verify keyboard-only interaction, 390px and desktop screenshots.

## Requirement mapping

REQ-1/4: existing product/risk/insured steps; REQ-2/3: coverage/review terms;
REQ-5: premium breakdown; REQ-6: validation/referral; REQ-7: company/agency;
REQ-8: submission samples and demo records; REQ-9: transaction documents;
REQ-10: component and browser checks in 04-test-design.md.
