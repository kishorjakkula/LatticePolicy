# Task Note: Policy Audit And Replay UI

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/53
- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/161

## Summary

Added an inline "Audit" detail panel to the policy versions table on
`PolicyViewPage` so internal users can inspect a transaction's actor,
processed vs. effective date, field-level changes, rating trace, UW
decision/override, generated forms/documents, and ledger events without
leaving the policy screen. Most of this data already existed on the backend
(`getPolicyTimeline`, `getPolicyVersions`, `getVersionDetails`,
`getPolicyState`); this change is primarily a UI aggregation of existing
APIs, plus one small backend addition to correlate a version row to its
timeline transaction reliably.

## Important Files

- `server/src/services/policy.service.ts`: `getPolicyVersions` now also
  selects and returns `transactionId` per version row (was previously only
  available in `getPolicyTimeline`'s `transactions[]`). This is the join key
  the audit panel uses to pull rating/UW/forms/documents/notes for a version.
- `server/src/openapi.ts`: documented the new `transactionId` field on
  `PolicyVersionRow`.
- `frontend/src/features/policies/TransactionAuditPanel.tsx` (new): renders
  the audit detail — actor/dates, field diffs (lazy-fetched via
  `apiDetails.getVersionDetails`), rating summary + calc trace, UW
  decision/override/reason, linked forms/documents (with an "Open" action
  that downloads the document content via the existing `#88` retrieval
  endpoint and opens it in a new tab), and matched ledger events.
- `frontend/src/features/policies/PolicyViewPage.tsx`: added an expand/collapse
  "Audit" column to the versions table (`findAuditTransaction` /
  `findAuditLedgerEvents` helpers do the join by `transactionId`, falling back
  to `transactionNumber` matching). No existing behavior was changed — the
  prior "Open" button that navigates to the read-only wizard view is
  untouched.
- `frontend/src/api/policies.api.ts`: `getPolicy` now accepts an optional
  `asOf` query param (the backend `getPolicyState` as-of support already
  existed and was unused by the frontend); added `downloadPolicyDocument`
  following the existing `exportPoliciesCsv` raw-fetch/blob pattern.
- `frontend/src/api/hooks/policies.hooks.ts`: added `usePolicyAsOf(id, asOf)`
  for point-in-time state lookups. Not yet wired into a date picker in the UI
  — see Follow-Ups.
- `frontend/src/api/client.ts`: re-exported `downloadPolicyDocument`.

## Behavior Rules

- The audit panel is internal-only; it is rendered from `PolicyViewPage`,
  which is already gated by `page.policy.view`. It is not reachable from the
  customer portal.
- Transaction correlation prefers `transactionId` (exact) and falls back to
  `transactionNumber` string matching only when `transactionId` is absent.
- Document "Open" respects the same tenant/permission/customer-safe checks as
  the `#88` retrieval endpoint — the frontend does not bypass or duplicate
  that authorization logic, it only calls the existing endpoint with the
  caller's auth headers.
- Out-of-sequence/rebased transaction metadata is rendered when present on
  `transaction.metadata` (`outOfSequence` / `isOutOfSequence` / `rebased`),
  but no part of the codebase currently sets these fields — issue #52
  ("Extend out-of-sequence handling beyond endorsements") is the tracked
  follow-up that would populate them.

## Automated Tests

- Tests added or updated:
  - `frontend/src/features/policies/__tests__/TransactionAuditPanel.test.tsx`
    — renders actor/date/UW/forms/documents/ledger sections, empty states
    when no transaction is linked, and the document-open action calling the
    download API with the right ids.
  - `server/src/__tests__/policy-audit-timeline.integration.test.ts` — binds,
    issues, and cancels a policy, then asserts every `getPolicyVersions` row's
    `transactionId` resolves to a matching `getPolicyTimeline` transaction,
    and that `getPolicyState` returns a coherent as-of snapshot.
- Test layer used: frontend component test (mocked API) + DB-backed server
  integration test.
- Why this layer is enough: the panel's rendering logic and the version↔
  timeline correlation are the only new behavior; both are deterministic and
  well covered by these two layers without needing Playwright E2E.

## Validation

```bash
npm run build
npm run test
npm run test:integration   # via scripts/test-integration.sh, disposable Postgres 15 container
```

All green: 70 frontend + 113 server unit tests, 26/26 integration tests
(including the 2 new ones), clean build, and clean root typecheck
(`npm run typecheck`).

## Follow-Ups Closed Out (this change)

- **As-of inspection UI**: added `PolicyAsOfPanel.tsx`, a collapsible "View
  policy as of a date" panel on `PolicyViewPage` with a date input calling
  `usePolicyAsOf`. Along the way, fixed a real pre-existing wiring bug:
  `usePolicyAsOf` called `api.getPolicy(id, asOf)`, which hit
  `GET /v1/policies/:id?asOf=...` — a query param the base policy endpoint
  never read. Issue #52's real as-of endpoint is
  `GET /v1/policies/:id/state?asOf=...`. Split `getPolicy(id)` (plain) from a
  new `getPolicyState(id, asOf)` hitting the correct endpoint, and repointed
  the hook at it. Verified server-side that `/policies/:id/state` exists and
  reads `asOf` (`server/src/routes/policies.routes.ts`).
- **Out-of-sequence/rebased metadata display**: issue #52 has since merged
  and populates `outOfSequence` / `rebasedTransactions` / `retroAdjustment`
  on `policy_transactions.metadata` for cancellation/reinstatement (see
  `server/src/__tests__/policy-lifecycle.integration.test.ts`). Traced the
  full path before assuming it "just works": `getPolicyTimeline` selects the
  raw `metadata` JSONB column and passes it through unmodified
  (`metadata: row.metadata || null`, `server/src/services/policy.service.ts`)
  — no field-stripping in between. `TransactionAuditPanel.tsx` now reads
  `timelineTransaction.metadata.rebasedTransactions` /
  `.retroAdjustment` and renders a rebased-transactions list and a retro
  premium-impact line when present, backed by a new render test case in
  `TransactionAuditPanel.test.tsx`. No new server code was needed — the data
  path was already correct end-to-end once traced; the gap was purely that
  the frontend never rendered fields that existed.

## Follow-Ups Or Risks

- Ledger-event correlation is best-effort, matched via
  `payload.transactionNumber` on the ledger row (the only correlation key
  ledger events currently carry). Ledger events that don't include a
  transaction number (e.g. some system-level events) won't appear under any
  transaction's audit panel; they remain visible in the existing
  policy-wide ledger card below the table.
- Document "Open" relies on `window.open` with a blob URL; this matches the
  browser download pattern already used for CSV export elsewhere in the app,
  but was not tested against a live browser popup blocker.
