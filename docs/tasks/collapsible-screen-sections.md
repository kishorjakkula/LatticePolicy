# Collapsible Screen Sections

## Summary

Every section card on the working screens can be collapsed to its header and
expanded again. This is the baseline section pattern for new screens.

## What Changed

- `frontend/src/components/CollapsibleSection.tsx`: shared section container.
  It keeps the caller's card classes (`card`, `ps-content-card`,
  `ps-table-card`, `policy-section-card`, `stack-card`), renders a toggle
  button in the header row, and hides the body when collapsed.
- Header: if the first child is an existing header (`h2`-`h4`, `panel-header`,
  `policy-section-header`, `policy-actions-header`, `ps-content-card-title`,
  `card-head`, `section-title`) it is reused, so header actions stay visible
  when collapsed. Otherwise pass `title`.
- Sections across admin, search, dashboard, policy view, customer view,
  customer portal, rating workbench, UW queue, placements, and the Quote Wizard
  sub-cards now use it. `as="section" | "form"` keeps the original element.
- Styles are at the end of `frontend/src/styles.css`.
- Quote Wizard steps (new business and endorse/cancel/renew transactions) are
  split into sections with the `wizard-section` class: Transaction Details
  (transaction modes only), Company & Agency, Product & Term, Prior Insurance,
  Qualification Questions, the three named-insured groups, Risk Details (each
  vehicle is also collapsible), Coverage Selection, Underwriting, and Premium.
- Search: Filters, and one results section per tab (Results, Quote Results,
  Customer Results).

## Behavior Rules

- Sections start expanded (`defaultOpen` can change that per section).
- The body stays mounted while collapsed, so unsaved form input is kept.
- Collapse state is per page visit; it is not persisted.
- The toggle is a `type="button"` with `aria-expanded` / `aria-controls`, so it
  never submits a form section.
- The body wrapper is `display: contents`, so a section's own flex/grid layout
  of its children is unchanged.
- A section title must not repeat the page title (duplicate headings break
  heading-based locators and are poor for screen readers).

## Not Converted

Page hero/header cards, KPI tiles, alerts and loading/error placeholders,
modals, the login page, wireframe pages, whole-page wrapper cards, inline
create bars, and cards that already contain a native `<details>` collapsible
(policy as-of panel, AI insights, timeline ledger). The wizard's workflow
rail, header, and navigation bar are not sections.

## Validation

- `frontend/src/components/__tests__/CollapsibleSection.test.tsx`
- `e2e/collapsible-sections.spec.ts`
- `npm run test:frontend`, `npm run typecheck`, `npm run test:e2e:isolated`
