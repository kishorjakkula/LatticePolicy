# WP-0004 Phase 1 part C: one primary, one pager, one disclosure

Work package: WP-0004 (REQ-5 wireframe removal, REQ-6, REQ-13 select fix, REQ-18).

## What changed

- **Live stylesheet.** Only `frontend/src/styles.css` (plus `styles/radio.css`,
  which it imports) and feature CSS files are loaded. The other files in
  `frontend/src/styles/` are unused copies; change `styles.css`.
- **Tokens.** Added `--ps-on-primary` and the danger set (`--ps-danger`,
  `--ps-danger-border`, `--ps-danger-soft`, `--ps-danger-focus`) beside
  `--ps-primary`, with dark-mode values.
- **One primary colour.** Bare `button`, `.action-btn--primary`,
  `.action-btn--success`, `.ps-filter-btn-search` and `.wizard-nav-next` all use
  `--ps-primary` / `--ps-primary-hover`. Green stays for success states
  (badges, toasts) only; `variant="success"` is kept for compatibility and
  renders as primary.
- **Danger.** `.btn-danger` and `.action-btn--danger` are outlined red.
- **One pager.** `TablePagination` keeps its props and renders the numbered
  `Pagination`. `Pagination` always lists the page size in use in its picker.
- **One disclosure.** Every `<details>` summary gets the circle +/- marker used
  by `CollapsibleSection` (zero-specificity `:where` rule, so classed summaries
  can restyle it); the policy History toggle no longer uses a triangle.
- **Selects.** Single-line selects drop vertical padding so a select given a
  smaller height no longer clips its text.
- **Forms list.** Form numbers do not wrap; row actions show "View"/"Edit"
  next to the icon (accessible names unchanged); scope reads "All states",
  "No approved state" or "No products".
- **Wireframes.** `/wizard-wireframes` and `/header-wireframes` and their pages
  are removed.

## Tests

- `components/__tests__/TablePagination.test.tsx`
- `features/admin/forms/__tests__/formScopeFilter.test.ts`
- `features/admin/__tests__/FormsManagementPage.scopeFilter.test.tsx`
- `__tests__/wireframe-routes-removed.test.ts`

## Not done here

- `UwQueue` still draws its own Prev/Next pager; it moves to `Pagination` in
  Phase 2 with the referral list rebuild (REQ-17). `PlacementsPage` now uses
  `Pagination`, and unknown routes (including the removed wireframe URLs) show
  `NotFoundPage` (both done in this phase).
- The `.wizard-wireframes-*` / `.wireframe-*` rules in `styles.css` no longer
  match any component. They are left in place to keep this diff small, and can
  be removed in a follow-up.
