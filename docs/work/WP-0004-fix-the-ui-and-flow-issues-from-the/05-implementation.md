# Implementation — WP-0004

Status: Phase 1 is historical; Phase 2/3 and the approved proposal-binding
extension are implemented on `latticepolicy/wp-0004-phase2`. Final local
verification and independent re-review passed. Gate C remains unapproved.

- Branch: `latticepolicy/wp-0004-ui-flow` (built on PR #391's branch).
- Task note: `docs/tasks/wp-0004-ui-consistency-part-c.md` (styles and pager); this file for the rest.

## Files changed

Phase 1, by requirement:

- **REQ-3 policy header.**
  - New `frontend/src/components/PageHeader.tsx`.
  - `features/policies/PolicyViewPage.tsx`: insured link or "No insured linked", product name, term, status with legend tooltip, "Premium this term", and an "As of" control in the header.
  - New `features/policies/policyPremium.ts`: the current-term premium only. The old code summed every term.
  - `PolicyAsOfPanel.tsx` split into the header control and a result card.
- **REQ-4 display names.**
  - `shared/displayLabels.ts`: transaction and document type labels, `documentDisplayName`, `POLICY_STATUS_LEGEND`, and sentence case for unknown codes.
  - Policy transactions table: one effective-date column and readable types.
  - `PolicyDocumentsPanel.tsx`: readable names and formats; version and transaction IDs behind "Details".
- **REQ-6 consistency.**
  - `styles.css`: one primary token for the green, blue and navy primary buttons; outlined danger style; one disclosure marker; danger and on-primary tokens.
  - `components/TablePagination.tsx` now renders the numbered `Pagination` (props unchanged, 18 callers untouched).
  - `features/placements/PlacementsPage.tsx` uses `Pagination`.
- **REQ-7 dates.**
  - `shared/dateDisplay.ts`: US `MM/DD/YYYY` and `MM/DD/YYYY h:mm AM/PM`; 24-hour elsewhere. A stored legacy US `MM-DD-YYYY` setting reads as slashes.
  - Server defaults (`server/src/config/tenant-preferences.ts`, `config.routes.ts`, `config.service.ts`) and the `TenantPage` defaults are now US `MM/DD/YYYY`.
  - `CustomerViewPage.tsx` uses the shared formatter.
- **REQ-13 search** (`features/search/**`, new `search.css`):
  - the page size in use always appears in the picker, and the pager agrees;
  - the header label no longer overlaps;
  - product names; status legend and tooltips;
  - select clipping fixed in `styles.css`.
- **REQ-14 (Submissions list).** `features/submissions/SubmissionsInboxPage.tsx` and `submissions.css`: a contained, focusable scroll region so the page does not widen.
- **REQ-18 Forms list.** `FormsManagementPage.tsx` list, `useFormsScopeCatalog.ts`, `forms-management.css`: no-wrap form numbers, View/Edit labels, scope wording.
- **REQ-5 (part): wireframe pages removed.**
  - Deleted `WizardWireframesPage.tsx` and `HeaderWireframesPage.tsx`, and removed their routes.
  - New `components/NotFoundPage.tsx` with a catch-all route.
- **Docs.** `docs/knowledge/ux/README.md` now names `frontend/src/styles.css` as the token source and records the button and pager rules.
- **Tests.**
  - New: PageHeader, NotFoundPage, TablePagination, policyPremium, PolicyViewPage header, wireframe routes removed, search page-size, legend and product names, submissions scroll region.
  - Updated: the date, displayLabels, documents panel, as-of and forms scope tests.
- **E2E selectors updated for the new text:** policy-lifecycle, policy-documents, pilot-product-pinning, multi-product, admin-customers, quote-wizard, underwriting-authority.

## Deviations from the design

- Display names extend the existing `shared/displayLabels.ts` instead of the planned new `displayNames.ts`, so there is still one label module.
- Tokens live in `frontend/src/styles.css`, not `styles/search-design-system.css` (an unused file). Recorded in the UX knowledge base.
- The policy h1 stays "Policy <number>" to keep heading checks; the insured is the first header fact.
- The Policy Summary still repeats the term dates; they are removed in Phase 3 with its layout pass.
- The UW queue's inline pager is replaced in Phase 2, when that screen is rebuilt (REQ-17).
- REQ-6 is partly in this phase. "Cancel" keeps its position and label among the policy actions until REQ-12 reorders them in Phase 2 ("Cancel policy", last, danger style).
- Review fixes (code review, Phase 1):
  - Date-times keep their time: the policy Updated column, the customer dates, document generated, audit events and submission timestamps.
  - Current-term premium restarts at new business, renewal and rewrite.
  - The non-renew dialog date uses the shared formatter.
  - The legend key "Bind" matches the status rows.
  - The undefined `--ps-text-body` token is replaced.
  - The Submissions primary button uses the primary token.
  - The pager uses a labelled group, and table pagers show "Showing a–b of N" again.
  - "No insured linked" shows for an empty customer record.
  - The "As of" result moves focus to itself.
  - Form documents are named by their form's title and code.
- Accepted with follow-up (code review):
  - Minor 3: an admin-chosen US `MM-DD-YYYY` setting reads as slashes, and TenantPage still offers it. To be decided with the product owner.
  - Minor 8: dark-mode contrast on primary, tracked under REQ-15.
- Unused wireframe CSS (148 lines inside media blocks) is left for the Phase 3 token pass.

## Checks run

Phase 1, Node 24.21:

- `npm run typecheck`: pass.
- `npm run test:server`: 777 passed.
- `npm run test:frontend`: 421 passed.
- `packages/rules` vitest: 221 passed.
- `npm run test:integration` (Docker runner): 38 files, 258 passed.
- Full `scripts/test-e2e-isolated.sh`: 142 passed, 2 failed on the new policy header.
  - Premium showed "Not rated" because UTC-midnight version dates were compared in local time.
  - A "Cancelled" exact-text check failed because the legend text sat inside the badge.
  - Both are fixed (calendar-date comparison with a US-time-zone test; legend moved beside the badge).
  - Rerun of the policy specs (policy-lifecycle, production-policy-scenarios, policy-documents, multi-product, admin-customers): 21 passed.

## Phase 2/3 working-tree continuation (2026-10-20)

The initial status above describes the committed Phase 1 baseline. The current
branch is `latticepolicy/wp-0004-phase2`; Phase 2/3 changes are implemented in
the working tree and are undergoing combined verification. No merge, release
or production deployment is authorized by these results.

- REQ-1/17: detail-only referral decisions, reason enforcement, richer queue,
  oldest-first Open triage and explicit review links from the wizard.
- REQ-2: shared in-app dialogs across users, customers, compliance, placements
  and form lifecycle actions, including pending-request and keyboard behavior.
- REQ-5: permission-aware Work menu/counts, grouped administration and admin
  attention home. Count caches include tenant and user; logout hides counts.
- REQ-8/9: product/term-first wizard, compatible company selection and billing
  at Premium; needs-attention submission review and counted bulk confirmation.
- REQ-10: eligibility matrix and 1-500-record atomic status changes with one
  before/after actor/reason audit per row; grouped searchable permission matrix.
- REQ-11: real authorized work counts/links, honest unavailable/stale states,
  zero-length bars, future-only forecasts and local-calendar renewal windows.
- REQ-14/15/16: compact phone pager and wizard stepper, collapsed phone search
  filters, theme-token source guard, readable primary/status/muted tokens,
  keyboard regressions and light/dark browser accessibility checks.
- REQ-19: server-paged AI audit with exact model/user/date filters, total and
  accessible detail panel; no audit-chain or raw historical-data mutation.
- API integration: detailed OpenAPI filters, paging and bulk contracts; CI's
  service database is explicitly marked disposable for the guarded suites.

### Referral rollback correction

Independent review found that fresh policy referrals could be rolled back with
the rejected endorsement/renewal/rewrite. Services now throw a typed internal
`PolicyReferralRequiredError` carrying server-evaluated work-item context.
Only those three HTTP mutation routes wrap their existing transaction with
`withPersistentPolicyReferral`: policy work fully rolls back first, then a new
tenant transaction retains/reuses only the referral and returns its committed
ID. Advisory locking serializes rejected retries. No unrelated error is caught
as a referral, no rejected policy writes are committed, and decision authority
remains at the explicit decision endpoint. New HTTP integration tests cover all
three flows, simultaneous first attempts, unchanged pre-approval state and
successful explicit-approval retries.

### Detailed handoffs

See `docs/tasks/wp-0004-workflow-regressions.md`,
`wp-0004-referral-detail-only.md`, `wp-0004-phase3-compliance-security.md`,
`wp-0004-phase3-dashboard.md` and `wp-0004-phase3-ai-audit.md`. Their scoped
results are not substitutes for final combined verification or human Gates C/D.

### Approved Proposal Binding (2026-10-21)

See `docs/tasks/wp-0004-referral-proposal-binding.md` for Migration 069,
canonical immutable evidence, four transaction callers, protected rollback
retention, exact-fingerprint lookup and current/proposed UI display. Independent
review identified concurrent new-business consumption and a spoofable UI
redaction marker; both were corrected with real HTTP concurrency and component
regressions. Quote revalidation and approval consumption now share the policy
creation transaction. No production deployment or merge was performed.

### PR #394 CI Follow-Up

The DB integration job and `scripts/test-integration.sh` now explicitly pass
`TENANT_RLS_ENFORCED=true` alongside the disposable-database flag. This fixes
the missing CI prerequisite for the existing AI audit isolation assertion;
no test or application behavior was weakened. Test setup guidance is updated
in `docs/TEST_PLAN.md`; verification is in the local deployment task note.
No approved-design change, application rebuild or data migration is needed.
