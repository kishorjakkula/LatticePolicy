# UI design — WP-0002

Knowledge used: `docs/knowledge/ux/README.md` (reviewed 2026-10-18),
`docs/UI_CONTROL_STANDARDS.md`, the wizard's Product and Coverages steps, and
the Operations Dashboard panels (`OperationsDashboardPage.tsx`).

## User journeys

- **Agent or underwriter quoting (new business):** Product step → choose product →
  … → Coverages step shows only that product's coverages → Apply Default Coverages
  → Rating → Premium lists only those coverages.
- **Agent changing product mid-quote:** on the Product step, picks a different
  product after insureds, risk details or coverages exist → a confirmation explains
  what will be cleared → Change product (data cleared, new product's steps) or
  Keep current product (nothing changes).
- **Agent rating a quote with an undefined coverage (API or stale screen):** Rate
  Premium → the rating error names the coverage and tells them to reapply the
  product's coverages.
- **Carrier administrator:** Administration → Operations Dashboard → "Coverage
  Integrity" panel lists records with coverages their product does not offer.

## Screens

| Screen | New or changed | Navigation | Requirements |
| --- | --- | --- | --- |
| Quote wizard — Product step | Changed: confirmation when changing product with entered data | Wizard step 1 | REQ-2 |
| Quote wizard — Coverages step | Changed: shows loading until the selected product's configuration is loaded | Wizard step 5 | REQ-1 |
| Quote wizard — Rating step | Changed: coverage errors from the server shown in the existing error banner with the codes | Wizard step 6 | REQ-3 |
| Operations Dashboard — Coverage Integrity panel | New panel | Administration → Operations Dashboard | REQ-5 |

## Layout

Product change confirmation (in-page dialog, the existing `modal-overlay` pattern):

```text
┌──────────────────────────────────────────────────────┐
│ Change product to Personal Auto?                     │
│                                                      │
│ Coverages, risk details and qualification answers    │
│ entered for Homeowners will be cleared. Insureds and │
│ policy details are kept.                             │
│                                                      │
│             [ Keep Homeowners ]  [ Change product ]  │
└──────────────────────────────────────────────────────┘
```

Coverages step while the configuration loads (existing text): "Loading product
config…" — the previous product's coverages are never shown.

Coverage Integrity panel (same `PanelShell` as "Policy Integrity Exceptions"):

```text
Coverage Integrity                                   (collapsible)
Records whose coverages are not offered by their product. Report only;
nothing is changed.
┌──────────┬──────────────┬───────────────┬───────────┬──────────────────────┬────────────┐
│ Record   │ Number       │ Product       │ Status    │ Unexpected coverages │ Date       │
├──────────┼──────────────┼───────────────┼───────────┼──────────────────────┼────────────┤
│ Policy   │ PC-…         │ Personal Auto │ Bound     │ A, B, C, D, E, F, …  │ 2026-10-18 │
│ Quote    │ Q20261018-…  │ Homeowners    │ Rated     │ DWELLING             │ 2026-10-11 │
└──────────┴──────────────┴───────────────┴───────────┴──────────────────────┴────────────┘
```

Record numbers link to the policy view or the quote in the wizard.

## Components

`CollapsibleSection` via the dashboard's `PanelShell`, the existing table styles
(`table-no-sticky-head` inside the scroll wrapper), `StatusBadge` for status, the
existing modal pattern for the confirmation, `ActionButton`/buttons as elsewhere.
No new components.

## States

- Confirmation: shown only when coverages, risk details beyond defaults, or
  qualification answers exist; changing an empty quote's product needs no dialog.
  Keyboard: focus starts on "Keep …"; Escape keeps the current product.
- Coverages step: loading until the matching configuration arrives; if loading
  fails, the existing "Loading product config…" message stays and the Rate button
  remains disabled by the missing coverages.
- Rating error: the banner lists each message ("Coverage END_WB is not offered by
  Personal Auto") and suggests "Go back to Coverages and apply the product's
  coverages."
- Integrity panel: loading (`PanelShell`), error, empty ("All quotes and policies
  carry only coverages their product offers."), list, more than 500 records
  ("Showing the 500 most recent").
- Permission-denied: panel hidden without `admin.dashboard.read` (page already
  requires it).

## Wording

- Dialog title: "Change product to {new product}?"
- Dialog body: "Coverages, risk details and qualification answers entered for
  {current product} will be cleared. Insureds and policy details are kept."
- Buttons: "Keep {current product}", "Change product".
- Rating error: "Coverage {code} is not offered by {product}."
- Panel description: "Records whose coverages are not offered by their product.
  Report only; nothing is changed."
- Empty: "All quotes and policies carry only coverages their product offers."

## Accessibility

Dialog has `role="dialog"`, `aria-modal`, a labelled title, focus moved in and
returned to the product select on close, Escape to cancel. Error banner uses
`role="alert"`. Table has column headers; codes are text, not colour. Contrast and
focus use existing tokens.

## Responsive behavior

Dialog buttons stack at 390px. The integrity table scrolls horizontally inside its
own wrapper; the page body does not scroll sideways.

## Requirement mapping

| Requirement | Screen and element |
| --- | --- |
| REQ-1 | Coverages step loading state; only the selected product's coverages listed |
| REQ-2 | Product change confirmation dialog |
| REQ-3 | Rating error banner wording |
| REQ-4 | Premium step coverage rows (unchanged layout; correct data) |
| REQ-5 | Coverage Integrity panel |
| REQ-6 | No visual change |
