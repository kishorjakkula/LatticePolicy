# Design — WP-0004

Gate A approved by Kishor Jakkula with the recommended defaults. The work is
mostly frontend presentation and flow, plus three small, additive server changes.

## Options considered

| Option | Benefits | Cost / risk | Decision |
| --- | --- | --- | --- |
| A. Incremental: add a few shared primitives (dialogs, display names, page header, nav model) and refactor screens onto them | Fits the existing design system (`CollapsibleSection`, `RadioGroup`, `StatusBadge`, `TablePagination`, `--ps-*` tokens); ships in three independent PRs; existing e2e and standards tests keep guarding | Some screens keep their structure; needs discipline to finish the long tail | **Selected** |
| B. Adopt a component library (Radix/MUI) and rebuild screens | Mature accessible primitives | Large rewrite, new dependency and licence review, every e2e selector changes, conflicts with carrier branding tokens | Rejected for this package |
| C. Fix each finding in place, no shared pieces | Fastest per item | Repeats the drift that caused the findings (four button colours, 29 native dialogs) | Rejected |

## Components touched

Frontend (`frontend/src`):

- New shared pieces:
  - `components/ReasonDialog.tsx` and `components/ConfirmDialog.tsx`: modal, labelled field, inline validation, focus trap and focus return, Escape cancels.
  - `shared/displayNames.ts`: products, transaction types, document types, statuses, plus a status legend.
  - `components/PageHeader.tsx`: title, key facts, primary action slot.
  - `components/AppNav.tsx`, extracted from `App.tsx`, with a nav model and `useWorkCounts` (referral and submission counts, polled every 60 s, hidden without permission).
- `shared/dateDisplay.ts`: country-aware; US shows `MM/DD/YYYY` and `MM/DD/YYYY h:mm AM/PM`.
- Screens:
  - UW queue and a new referral detail decision panel.
  - Policy page header, actions, transactions and documents.
  - Search results.
  - New quote wizard (step 1 order; billing moved to the Premium step with the same `QuoteState` fields).
  - Submission review defaults.
  - Dashboard ("My work", zero bars, future-only forecast, refresh time, axis labels).
  - Administration layout (grouped menu and admin home).
  - Compliance grid, Security matrix, AI audit paging and filters, Forms admin list.
- Styles: one primary button token; a danger style; one pager (`TablePagination`); select line-height fix; table header widths.
- Removed: the `/wizard-wireframes` and `/header-wireframes` routes and their pages.
- New standards tests, in the style of `__tests__/radio-standard.test.ts`:
  - `design-tokens.test.ts`: no hex colour literals in features or components.
  - `native-dialogs.test.ts`: no `prompt(` or `confirm(` calls.

Server (`server/src`), additive only:

1. `uw-referral.service.ts` `listReferrals`:
   - Optional `sort=oldest|newest`, default `oldest` for status Open.
   - A LEFT JOIN to the latest policy version premium returns `premium`, alongside the existing `insuredName`, `productCode` and `createdAt`.
2. `uw-referral.service.ts` decide:
   - Approved and Declined require a non-empty reason; the response is `400 REASON_REQUIRED`.
   - This is applied in the service, so `/decide`, `/approve` and `/decline` all enforce it.
   - InfoRequested keeps an optional comment.
3. `compliance-admin.routes.ts`: new `POST /admin/compliance/eligibility/bulk`.
4. `ai-audit.service.ts`: add `offset`, `actorKind`, `model` and `actor` filters where missing; the response keeps its shape plus `total`.

## Data and migrations

None. No table, column or RLS change. All server changes read or update existing
tables within existing tenant-scoped transactions.

## API contract

- `GET /v1/uw/referrals?status=Open&sort=oldest&page=1&pageSize=20`. The response adds `premium` (Money or null) to each item. An unknown `sort` returns `400 INVALID_SORT`.
- `PATCH /v1/uw/referrals/:id/decide`, `/approve` and `/decline` now return `400 REASON_REQUIRED` when the decision is Approved or Declined and the reason is blank.
  - This is a contract change. Update the API docs, e2e helpers and the OpenAPI description.
- `POST /v1/admin/compliance/eligibility/bulk`. Request: `{"ids":["<uuid>",…],"status":"Inactive","reason":"Withdrawn filing"}`.
  - 1–500 ids per request. Status must be one of the existing eligibility statuses; reason is required.
  - Response: `{"updated":10,"items":[…]}`.
  - Errors: `400 INVALID_INPUT`, `403 FORBIDDEN` (same `canManage` rule as PATCH), `404 NOT_FOUND` if any id is not in the tenant (no partial update), `409` on concurrent change.
  - Runs in one transaction with `FOR UPDATE` on the rows and one audit event per row.
- `GET /v1/admin/ai-audit?offset=0&limit=25&actorKind=ai&model=…&actor=…&from=…&to=…`. Adds the filters and `total`; strict validation of the existing parsed schema.
- All new or changed routes join the generated OpenAPI inventory.

## Security, tenancy and audit

- Referral decisions:
  - Server authority checks are unchanged (`uw.referrals.decide`, `AUTHORITY_OVERRIDE_REQUIRED`).
  - The new reason rule closes the gap where the UI could decide without one.
  - The reason is recorded in the referral comment trail as today.
- The bulk compliance change:
  - Is tenant-scoped (`tenant_id = $1` on every statement, `withTenantTx`, RLS) and uses the existing manage permission.
  - Writes per-row audit entries with actor, reason and before/after.
  - Has no partial success.
- Nav counts:
  - Only call endpoints the user already has permission for; a missing permission hides the item.
  - Counts reveal nothing beyond the list the user can already open.
- Dialogs:
  - Reason text is sent only to the endpoints that already accept it.
  - Nothing new is logged client-side.
- No PII is added to new screens: insured name already shows in referral detail and search.

## Performance, operations and configuration

- Nav counts: two lightweight list calls (`pageSize=1`, reading `total`) every 60 s per open tab, paused when the tab is hidden.
- The referral list premium join uses an existing index on policy versions by policy; it is checked with `EXPLAIN` in the integration test.
- The compliance bulk update is bounded to 500 rows; the grid loads paged by product.
- No new configuration or feature flags; the changes are presentation plus additive endpoints.
- Rollback: revert the frontend. The added endpoints and filters are unused when reverted. The reason rule is the only behavior change and reverts with the service change.

## Delivery

One work package, three pull requests:

1. **Quick wins.** REQ-3, REQ-4, REQ-6, REQ-7, REQ-13, REQ-18, the REQ-14 Submissions scroll fix, and removing the wireframe routes.
2. **Workflow.**
   - REQ-1 and REQ-17 (with the referral server changes).
   - REQ-2: the dialogs plus the standards test.
   - REQ-5 navigation.
   - REQ-8 wizard.
   - REQ-9 submission review.
   - REQ-12 policy actions.
3. **Restructure.** REQ-10 (with the bulk endpoint), REQ-11 dashboard, REQ-14 phone layouts, REQ-15 accessibility pass, REQ-16 token test and fixes, REQ-19 AI audit.

## Requirement mapping

| Requirement | Design elements |
| --- | --- |
| REQ-1 | Referral detail decision panel; list "Open" only; server reason rule |
| REQ-2 | `ReasonDialog` / `ConfirmDialog`; native-dialogs standards test |
| REQ-3 | `PageHeader` on policy page with insured link, product name, current term, premium, as-of control |
| REQ-4 | `displayNames.ts`; version IDs under "Details" |
| REQ-5 | `AppNav` model, Work area, counts, grouped admin menu and admin home; wireframe routes removed |
| REQ-6 | Button tokens, danger style ordering, single pager and disclosure |
| REQ-7 | `dateDisplay.ts` country-aware formats; date input pattern |
| REQ-8 | Wizard step 1 field order; billing in Premium step; single progress indicator; header summary |
| REQ-9 | Submission review default filter, group summaries, placeholders, bulk-accept confirmation |
| REQ-10 | Compliance grid + bulk endpoint; Security role × permission matrix |
| REQ-11 | Dashboard My work, bar baseline, future forecast, refresh time, axis fix |
| REQ-12 | Policy actions availability reasons; transaction columns; table sort indicators |
| REQ-13 | Search page-size state, header widths, product names, status legend, select fix |
| REQ-14 | Scroll containers, phone cards, compact pager, filter sheet |
| REQ-15 | Accessible names/tooltips, contrast tokens, target sizes; axe check in e2e |
| REQ-16 | Token standards test; existing literals replaced |
| REQ-17 | Referral list columns, oldest-first sort, assign action (existing endpoint) |
| REQ-18 | Forms list no-wrap, labelled actions, scope wording |
| REQ-19 | AI audit filters/paging (service) + paged table and side panel (UI) |

## ADR

None. These are application-internal UI conventions, recorded in
`docs/knowledge/ux/README.md` (updated by the knowledge curator) rather than in
an architecture decision.
