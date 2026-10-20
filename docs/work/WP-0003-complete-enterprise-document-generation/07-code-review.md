# Code Review - WP-0003

- Reviewer: independent fresh Codex review session, separate from the developer.
- Reviewed: 2026-10-18, current uncommitted feature changes over HEAD `25606a0`.
- Scope: forms/rules/admin and transaction archive changes, including subsequent
  local fixes in shared context construction and lifecycle document callers.
  Relevant feature-owned untracked files were included; unrelated research,
  output and other untracked files were excluded.
- Status: scoped review evidence only. All previously identified concrete
  findings are resolved in the inspected code. The Issue test verification hold
  is resolved on the final author-reported diagnosis and passing reruns below.
  This does not complete stage 7 or WP-0003, approve a human gate, or establish
  readiness of the broader enterprise document-generation implementation.

## Date Precedence Finding Rechecked

| Severity | File:line | Finding | Failure scenario | Outcome |
| --- | --- | --- | --- | --- |
| P2 | `frontend/src/features/wizard/QuoteWizard.tsx:191-195` | New-term preview previously preferred the payload effective date over the explicit transaction effective date. | In renewal/rewrite, leave Product Effective Date at `2027-01-01`, set Transaction Effective Date to `2027-02-01`, and use a 12-month term. Previously preview exposed January dates while generation used February dates. | Fixed and independently rechecked: `facts.effectiveDate` now has precedence. Direct helper/engine assertions pass for Renewal and Rewrite with six- and twelve-month terms. The component regression now expects February to August for six months. |

Backend evidence: `renewPolicy` uses `body.effectiveDate` before its default
(`server/src/services/lifecycle.service.ts:873-881`); `rewritePolicy` uses it
before the payload date (`server/src/services/lifecycle.service.ts:1200-1208`).
The wizard permits these dates to differ: changing Transaction Effective Date
updates its separate state without changing `q.effectiveDate`.

## Prior Findings Rechecked

| Prior concern | Latest evidence | Outcome |
| --- | --- | --- |
| Missing generation attributes and enriched UW aliases | Shared builder derives first-risk/business attributes, merges UW answers and supplied facts, and derives stage flags (`packages/rules/src/form-attachment.ts:181-198`). NB, endorsement, renewal and rewrite callers supply UW decision/override facts. | Fixed for the reviewed aliases; direct engine checks passed. Not a claim that all database fields are exposed. |
| Missing lifecycle premium/policy facts | Lifecycle callers now supply premium/status/term facts; endorsement selection uses `endorsementPremium.premium` (`server/src/services/endorsement.service.ts:897`), not the current policy's full premium. | Fixed by inspected caller wiring. |
| Issue lacked pinned underwriting decision/override | Tenant-correlated transaction/lateral-version query selects `pt.uw` and `override_reason`, then supplies them to Issue generation (`server/src/services/lifecycle.service.ts:218-249`). | Fixed in inspected SQL/caller wiring. Verification hold resolved on author-reported real-DB reruns; UW/premium/status/term conditions and their composite passed. These suites were not reviewer-executed. |
| Payload transaction/policy facts replaced by explicit context | Shared builder merges payload and explicit objects (`packages/rules/src/form-attachment.ts:164-168`). | Fixed; direct reason-code/policy-fact preservation checks passed. |
| Coverage limits/deductibles lost in preview | Preview helper supplies full payload coverages; old selected-code override is removed (`frontend/src/features/wizard/QuoteWizard.tsx:210-216,1835`). | Fixed; direct coverage-rule check passed. |
| Raw wizard state used instead of canonical payload | Actual preview builds `buildQuotePayload(q)` and includes `normalizedInsureds` in effect dependencies (`frontend/src/features/wizard/QuoteWizard.tsx:1826,1878`). | Fixed by inspected actual call path, including derived UW answers and normalized insureds. |
| Display status/internal status and Rewrite status disagreed | Preview prefers `internalStatus` for existing policies and assigns Rewrite's resulting `Issued` status (`frontend/src/features/wizard/QuoteWizard.tsx:185-189`). | Fixed; direct helper checks passed. Date precedence was subsequently fixed and rechecked above. |
| Nested/flat policy term aliases differed | Shared builder normalizes both representations (`packages/rules/src/form-attachment.ts:169-172`). | Fixed; direct checks passed in both directions. |
| Archived Issue forms labeled Bind | Admin and catalog selections pin stage into selected form metadata (`server/src/services/document-generation.service.ts:432,490`), which persistence snapshots and version projection retain. | Fixed for newly recorded forms; legacy rows without stage are not retroactively reconstructed. |
| Refresh did not refetch unchanged filters | Dedicated Refresh handler calls list/detail refetch and reloads selected-form side data (`frontend/src/features/admin/FormsManagementPage.tsx:147`). | Fixed by inspected handler/button wiring. |
| Catalog hydrated every form detail | UI consumes list projections; all-form detail hydration removed. SQL product/state/transaction/template projections correlate both tenant and form (`server/src/routes/forms-admin.routes.ts:150-153`). | Fixed by inspected query/UI paths; no cross-tenant projection found. |
| Priority/type validation and publication race hardening | Strict priority/expression-type validation and shared form-row locks are present in authoring/publication paths. | Rechecked statically; not duplicated as new findings. |

## Historical Document Persistence Follow-Up

- Reviewed the subsequent `server/src/persistence.ts` change: worksheet insert
  and existing-row update both assign SQL `documents.versionId` from
  `versionRow.versionId` (`:586,605`), matching the snapshot metadata. Version
  selection is tenant/policy/transaction scoped; existing document selection
  and mutation retain tenant/policy scope. No new scoping regression found.
- Bind packet persistence now receives `versionId`
  (`server/src/services/quote-bind.service.ts:836`). The same version is already
  inserted before rating/worksheet persistence; the packet's metadata and SQL
  ownership therefore identify the intended bound version.
- Exact-version details still require tenant, policy, SQL version ID and the
  version's transaction ID (`server/src/services/policy.service.ts:810-815`);
  the persistence fixes do not broaden that query to metadata-only or
  policy-wide ownership.
- Inspected the added real-API integration assertion
  (`server/src/__tests__/document-artifact-storage.integration.test.ts:255-257`):
  the listed worksheet must have a version ID and occur in that version's
  detail response. This is useful positive-path coverage; the reviewer did
  not execute the Docker-backed integration suite.
- These assignments repair newly persisted/upserted rows, not untouched legacy
  rows with NULL SQL version IDs. No backfill or regeneration is implied.
- Outcome: no additional concrete finding in these narrowly scoped changes.
  The P2 preview term-date precedence finding was subsequently fixed and rechecked.

## Verification Hold Resolved

- Author-reported diagnosis: the Issue regression test queried the wrong form
  identity. Admin-sourced `policy_forms.form_id` is intentionally NULL because
  that column references the catalog; its admin identity is
  `metadata.sourceFormId`. The test lookup was corrected and temporary
  diagnostics removed. No new backend Issue defect was established.
- Final results reported by the author through the parent session: Issue/artifact
  storage **8 passed**, policy lifecycle **6 passed**, totaling **14 real-DB
  tests passed**. Issue-only UW, premium, status and term conditions, plus the
  composite condition, all passed.
- Final author-reported E2E results: **6/6 passed across all three specs**,
  including the historical scoped-blob hash check.
- These counts and the diagnosis are author-reported evidence, not independent
  reviewer execution. This resolves the reported test hold, not the broader
  enterprise qualification scope. No ready/release/stage-complete outcome or
  human-gate approval is recorded by this reviewer.

## Verification And Limits

- Read `AGENTS.md`, `agents/code-reviewer.md`, delivery workflow, WP requirements,
  design/UI/test/implementation context, and relevant project/security/UI docs.
- Re-read changing local source before this final evidence update.
- Ran read-only `node --import tsx --input-type=module -e ...` probes importing
  the shared engine. Extracted the actual preview helper/date helper with
  esbuild in memory; no temporary source files were created.
- Passing checks covered aliases, transaction merge, term aliases, coverage
  values, supplied Issue UW context and internal/resulting statuses.
- Final date-fix verification: direct assertions against the latest extracted
  preview helper and shared engine passed for Renewal and Rewrite at six months
  (`2027-02-01` to `2027-08-01`) and twelve months (`2027-02-01` to `2028-02-01`),
  despite a stale January payload date. Both flat/nested term aliases matched,
  and `policy.termEffectiveDate == transaction.effectiveDate` evaluated true.
- Inspected the updated differing-date regression in
  `frontend/src/features/wizard/__tests__/transactionDocuments.test.tsx:84-91`;
  the reviewer ran the direct assertions above, not the full component suite.
- No Docker, database/browser integration run, or full test suite was executed
  by this reviewer. Author tests were inspected, not claimed as reviewer-run.
- `git diff --check` passed for the historical persistence, bind caller,
  document-artifact integration test and this review document's tracked diff.
- No additional concrete tenant-scoping, React effect-loop or unsupported-upload
  regression was identified in this scoped diff. This is not enterprise,
  security/compliance, performance, archive-restore or carrier UAT sign-off.
- Only this review document was edited. No workflow/status/gate action was taken.

## Second Review - Claude Code, 2026-10-19

Separate session from the developer. Findings over the same uncommitted diff:

| Severity | File | Finding | Outcome |
| --- | --- | --- | --- |
| High | `packages/rules/src/form-attachment.ts` | Context caps (1,000 items, 50,000 values, payload copied ~3x) blocked bind/issue for large schedules with a misleading form-configuration error. | Fixed by the author of this review; see `05-implementation.md`. |
| Medium | `server/src/routes/forms-admin.routes.ts` | `PATCH /:id` could set or clear `attachmentRulesVersion`; it also replaced metadata with `{}` when the request omitted it, so a UI details save turned rules off. | Fixed. |
| Medium | `server/src/services/document-generation.service.ts` | Every servicing transaction carried stage `Issue`, so issuance-stage rules fired on cancellations; Quote-stage rules previewed but never generated. | Fixed. |
| Medium | same | Rule context rebuilt per joined form row. | Fixed. |
| Low | several | Form-wide suppression unclear in UI; unknown transaction types defaulted to new business; full trigger rows (user IDs, timestamps) pinned on documents. | Fixed. |
| Low | `form-attachment.ts:143` | Coverage without `selected` counted as selected. | Withdrawn: matches the platform convention (`coverageUtils.ts`, `selected !== false`). |

Because this reviewer also wrote the fixes, they need an independent review
before stage 7 can complete. No gate is approved by this review.

## Independent Review Of Fixes - 2026-10-19

Separate session from the developer and from the second reviewer who wrote the
fixes. Scope: the "Review Fixes - 2026-10-19" changes over the uncommitted
WP-0003 slice. No gate is approved by this review.

| Severity | File | Finding and failure scenario | Outcome |
| --- | --- | --- | --- |
| Major | `packages/rules/src/form-attachment.ts:53-57`, `:95`; reachable via `server/src/routes/forms.routes.ts:19` -> `forms.service.ts:314` | The raised bounds no longer bound memory or CPU. `MAX_NODES` counts objects only (5,000,000), and the memo `copies` map keeps every source object alive alongside two full copies. Measured on Node 24: a 7.5 MB JSON body of 2.5M empty objects took 5.5 s of synchronous event-loop time and 1.1 GB heap; about 15 MB (4.9M objects, under the 25 MB body limit) ran the process out of heap and aborted it. Any user with `page.wizard.view` can POST that to `/v1/forms/preview` once one approved, opted-in form with active rules matches the chosen product, and crash the API for every tenant. The old 50,000-value bound prevented this. | Returned. Bound by what rules need, not by the body limit: cap objects at a few hundred thousand and count primitives too (5,000 locations x 30 fields is about 5,000 objects), and/or copy only the roots and paths the active rules reference. Also give `/forms/preview` a small body limit (the wizard payload is KBs). Add a test that a ~10 MB synthetic body fails fast with `FORM_ATTACHMENT_CONTEXT_TOO_LARGE`. |
| Minor | `server/src/services/lifecycle.service.ts:443`, `form-attachment.ts:233` | `uw.isIssued` for servicing transactions is `status != 'bound'`, but cancellation passes the resulting status `Cancelled`. Cancel is allowed from `Bound` (`transaction-state.ts:52`), so flat-cancelling a bound, never-issued policy reports `isIssued: true`. Endorse, renew and non-renew are only allowed from `Issued`, and reinstate and rewrite move to `Issued`, so cancellation is the only affected path. The wizard does the same (`QuoteWizard.tsx` sends `Cancelled`). The test at `form-attachment.test.ts:85` covers Endorse on a Bound policy, which the state machine does not allow. | Returned. Pass the pre-transaction status, or an explicit `wasIssued`, for cancellation. Test cancel from Bound. |
| Minor | `frontend/src/features/admin/forms/FormScenarioTest.tsx:56,69` | `05-implementation.md` says the admin scenario test evaluates at Bind. It does not: with the default transaction `Quote` (or `Bind`) and stage "Use transaction context", no stage is sent, so `transaction.stage` is unset and `uw.isBound` is false. A `transaction.stage == 'Bind'` rule shows "not returned" in the scenario test but attaches at a real bind. | Returned. Derive Bind for Quote/Bind and Issue for Issue when no stage is chosen (client or `previewForm`), or correct the claim. |
| Minor | `server/src/services/forms.service.ts:59-71`, `:314` | The preview normalizer still maps any unrecognized `transactionType` (for example `NonRenewal`) to `''`, which then defaults to new business. This is the silent-default the fix meant to remove. Server generation is safe: every `PolicyDocumentTransactionType` (NB, Issue, Endorse, Cancel, Reinstate, Rewrite, Renew, NonRenewal) parses (verified). | Returned (low priority). Pass the raw type through to the context, or reject it. |
| Minor | `packages/rules/src/form-attachment.ts:154`, `:376` | The `builtContexts` bypass trusts an object that stays mutable. Verified: adding a getter to a built context after building runs it during evaluation. No current caller mutates the context (it lives in the lazy closure), so this cannot be exploited today, but the protection relies on convention. | Returned. Freeze the copy during snapshot (`Object.freeze` per node), or drop the bypass. |
| Minor | `packages/rules/src/form-attachment.ts:111-113` | Memoizing shared references skips the depth check for a subtree reached again at a greater depth. Verified: a 2,000-level chain of shared objects builds despite `MAX_DEPTH` 64. A DAG that doubles at each level is also accepted, so anything that later fully traverses it (for example `JSON.stringify`) would blow up. JSON input cannot carry shared references, so only server-composed input can trigger this. Information only. | Accepted with reason (not reachable from request data). Optionally record subtree height with each memo entry. |
| Minor | `server/src/routes/forms-admin.routes.ts:558-560`, `:2536-2539` | `withServerOwnedMetadata` re-appends `attachmentRulesVersion` at the end. jsonb returns keys in its own order, so the `JSON.stringify` comparison can report a change when nothing changed (a key longer than 22 characters sorts after the flag). On an Approved, edit-locked form, an API client that echoes metadata unchanged then gets `LOCKED`. Array metadata is accepted and stored as `{"0":...}` (this was already true). The UI does not send metadata, so it is unaffected. | Returned (low priority). Compare with a key-order-insensitive deep equal, and reject non-plain-object metadata with 400. |
| Minor | `frontend/src/features/admin/FormsManagementPage.tsx:752` | The page still says "Lifecycle stage conditions use transaction.stage." That is now wrong for servicing transactions (use `transaction.type`). | Returned. Update the wording. |
| Minor | `server/src/services/__tests__/form-attachment.service.test.ts:123` | "evaluates each form once although the joins return a row per jurisdiction" only checks that one form is returned, which the `seen` dedupe already guaranteed. It runs the cache path but does not prove it. | Returned. Spy on evaluation, or count rule evaluations. |

Verified and found correct:

- `selectPolicyForms` reordering: the decision depends only on form metadata and triggers, so caching per `form_id` after the transaction, endorsement and regulatory filters and the `seen` check does not change which forms attach. The context is lazy, so a form that is not opted in never builds it. That means fewer throws than an eager build, not more.
- Unknown-type rejection: every server caller (quote-bind `NB`; lifecycle Issue, Cancel, Reinstate, Renew, Rewrite, NonRenewal; endorsement `Endorse`), every wizard type (`NB`, `Endorsement`, `Cancellation`, `Reinstatement`, `Rewrite`, `Renewal`) and every admin `FORM_TRANSACTIONS` value parses. `quote_bind` and `Quote Bind` are rejected (only `quotebind` is aliased). No caller sends these.
- Removing `transaction.stage` from servicing transactions: no product pack, seed, tenant config or knowledge doc references `transaction.stage` or `uw.isIssued`. The only `stage == 'Issue'` uses (`document-artifact-storage.integration.test.ts:222`, e2e) are new-business Issue, which keeps its stage.
- `attachmentRulesVersion` ownership: create strips it; PATCH keeps the stored value and replaces metadata only when sent; PATCH and rule writes lock the same row `FOR UPDATE`. Clone copies the flag together with the opted-in triggers, so the clone stays consistent. The seed writers (`admin.routes.ts:1080`, `product-document-templates.service.ts:58`) never set the flag. No integration test covers POST create with the flag (gap).
- Pinned rule projection stores only ID, type, expressions, priority and active.

Checks run (Node 24.21, host): `packages/rules` vitest 218 passed; server
`form-attachment.service`, `document-generation.service`,
`policy-version-documents` 56 passed; frontend `src/features/wizard` and
`src/features/admin` 212 passed; `tsc --noEmit` for server and rules passed.
Scratch probes (outside the repo) confirmed the cancel `isIssued` result, the
admin no-stage result, the getter bypass, the depth bypass, transaction-type
parsing, and the memory and time figures above. Docker and E2E suites were not
run.

Result: one open Major (unbounded context build reachable from the wizard
preview endpoint). Stage 7 is not complete until it is fixed and re-verified.

## Re-check Of Review Fixes - 2026-10-19

Same independent reviewer, re-checking "Fixes For The Independent Review -
2026-10-19" against the current working tree. No gate is approved.

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Major: context build exhausts memory and CPU | Resolved | Every value and memo hit counts toward `MAX_VALUES` 500,000 (`form-attachment.ts:107`). Re-ran the probes: 2.5M objects (7.5 MB) and 4.9M objects (14.7 MB) are rejected with `limits` in about 0.46-0.49 s and about 150 MB. Previously the 4.9M body aborted the process. The worst case that still builds (400k objects in a 1.2 MB body) takes about 0.75 s and 266 MB. Real schedules fit: 5,000 x 50 fields builds in 177 ms, 9,000 x 50 in 289 ms, 10,000 vehicles x 25 in 250 ms. Each request is synchronous, so concurrent requests queue rather than stack memory, and `appLimiter` (600 requests per 15 min) caps one client at about a third of one event loop. Residual: no per-route body limit, so `/v1/forms/preview` still accepts 25 MB, and express parses it before our cap applies. Recommended, not blocking. |
| 2 | Cancel-from-Bound `isIssued` | Resolved | `lifecycle.service.ts:443` passes `priorStatus: policyRow.status`, and `QuoteWizard.tsx:202` does the same for cancellation only. Probe: cancel with prior status Bound gives `isIssued` false; prior status Issued gives true. See new finding B. |
| 3 | Admin scenario stage | Resolved | `FormScenarioTest.tsx:56-58`: Quote/Bind default to Bind and Issue to Issue, unless a stage was chosen or the JSON has one. |
| 4 | Preview silently defaulted unknown types | Resolved, with a regression (new finding A) | `forms.service.ts:60-73` maps the non-renewal variants and throws `INVALID_INPUT` (400) for other types. |
| 5 | Mutable trusted context | Resolved | `snapshot(result, true)` freezes every node. Probe: redefining a property on a built context throws `Cannot redefine property`, and nested `policy`/`payload` are frozen. Evaluation, including `sum`, still works. |
| 6 | Depth bypass through shared references | Accepted (unchanged) | The developer's reasoning holds: copying is linear because memo hits are reused (and now counted), JSON request data cannot share references, and evaluation follows fixed paths. |
| 7 | PATCH metadata | Resolved | Non-object or array metadata returns 400 before any write (`forms-admin.routes.ts:558-559`, mapped at `:635`). `canonicalJson` (`:2538`) sorts keys recursively. Leftover: POST create still accepts array metadata through `normalizeFormPayload` and stores it as `{"0":...}` (new finding C). |
| 8 | UI wording | Resolved | `FormsManagementPage.tsx:752`: "New-business stage conditions use transaction.stage (Bind or Issue); servicing transactions use transaction.type." |
| 9 | Weak evaluate-once test | Resolved | `form-attachment.service.test.ts:123-133` counts getter reads of `attachment_triggers` across three joined rows and expects 1. Without the cache it would be 3. |

New defects introduced by these fixes:

| Severity | File | Finding and failure scenario | Suggested fix |
| --- | --- | --- | --- |
| Minor (A) | `server/src/services/forms.service.ts:60-73` | The preview normalizer now rejects `NB`, `new_business`, `newbusiness` and `quotebind`, which `parseValidationTransaction` accepts as new business. An API integrator calling `/v1/forms/preview` with `transactionType: 'NB'` (the document-generation vocabulary) used to get an unfiltered preview and now gets 400. The wizard and admin UI never send these, so nothing in the product breaks. | Accept the same aliases as `parseValidationTransaction`, for example by mapping it to the preview labels. |
| Minor (B) | `packages/rules/src/form-attachment.ts:208,238` | `priorStatus` is read from the merged policy, which includes `payload.policy`. For a non-cancel transaction, a stale `payload.policy.priorStatus: 'Bound'` in a stored snapshot flips `isIssued` to false. Probe: Endorse with that payload gives `isIssued: false`. No current writer stores it, so the risk is low. | Read `priorStatus` only from the explicit `clean.policy`, and only when the type is cancellation. |
| Minor (C) | `server/src/routes/forms-admin.routes.ts:~2460` (`normalizeFormPayload`), create path | POST create still accepts array metadata and stores it as an object with index keys. This was already true before these fixes; PATCH now rejects the same input. | Apply the same 400 check on create. |

Checks run (Node 24.21, host): `packages/rules` vitest 220 passed; server
`form-attachment.service`, `document-generation.service`,
`policy-version-documents`, `forms.service` 63 passed; frontend
`src/features/wizard` and `src/features/admin` 212 passed; `tsc --noEmit`
passed for server, rules and frontend. Scratch probes were re-run outside the
repo. Integration (PostgreSQL), Docker and E2E suites were not run.

Result: no open blockers or majors. Three new minors (A-C), returned at low
priority, plus the recommended per-route body limit.

## Review Of P1 Fixes - 2026-10-19

Reviewer: independent Claude Code session, separate from the developer. I reviewed the
committed content of `ee9224a`, `19d0639` and `0d8bf15` (`git show`, `git show HEAD:<path>`),
not the working tree, which other agents are editing.

### Verdict

The three P1 findings in `docs/tasks/wp-0003-latest-implementation-review.md` are fixed.
I found no blockers and no majors. There are four minors and some nits, listed below.
Merge is not blocked from the code-review side.

### What I verified

- P1-1 (jurisdiction): `selectPolicyForms` now selects `f.require_approved_jurisdiction` and
  gets every jurisdiction row for the form through `jsonb_agg`. `formJurisdictionDecision`
  applies that flag. The old filtered LEFT JOIN, which let a form through whenever no row
  joined (NY-only, expired, or not yet effective), has been removed. `$3`/`$4` are gone and
  the parameter list matches (`$1`, `$2`). `jsonb_build_object` turns `date` into a
  `YYYY-MM-DD` string, which `asDateOnly` reads without converting time zones. The subquery
  is correlated per output row and is indexed on `(tenant_id, form_id, ...)`. Jurisdictions
  no longer add rows, and the `has_app` logic is unchanged.
- P1-2 (stage): I listed every `transactionType` that reaches generation:
  `NB` (quote-bind.service.ts:723,834), `Issue`, `Cancel`, `Reinstate`, `Renew`, `Rewrite`,
  `NonRenewal` (lifecycle.service.ts) and `Endorse` (endorsement.service.ts). All of them
  resolve in `TRANSACTION_ALIASES`. Preview passes the normalized `Quote`, `Bind`, `Issue`,
  `Endorsement`, `Renewal`, `Cancellation`, `Reinstatement`, `Rewrite` or `NonRenewal`, or
  `''` (no filter) for NB/QuoteBind. All of these resolve.
- Removed helpers: no references remain to `matchesTransactionType`,
  `pickMatchingPreviewJurisdiction`, `FORMS_PREVIEW_TRANSACTION_TYPES` or
  `FORMS_PREVIEW_DEFAULT_FUTURE_DATE`. `normalizeTransactionType` in
  document-generation.service.ts is still used for the endorsement check.
- Stored scopes that could stop or start attaching:
  - The admin routes only save `Quote`, `Bind`, `Issue`, `Endorsement`, `Renewal`,
    `Cancellation`, `Reinstatement` and `Rewrite` (forms-admin.routes.ts:25, 2851).
  - The ISO seed uses that same list plus Approved rows for all states.
  - The product template seed uses `[]`, `['NB']` and `['NB','Renew']`.
  - Integration fixtures use `NB`, `Endorse`, `Cancel`, `Reinstate`, `Renew`, `NonRenewal`
    and `Rewrite`, all in CA with Approved rows from 2026-01-01 and effective dates in
    2026-07 to 2026-11.
  - `forms_catalog` sample seeds have no transaction scope.
  - No stored value uses spaces, and none is unknown, so the "unknown matches nothing"
    rule changes no seeded form.
  - No seed or fixture stores a Pending or Withdrawn row.
- UI: `isComplianceAdmin` in the UI matches the server
  (forms-admin.routes.ts:3072). The frontend `hasPermission` returns true for role `admin`,
  and `compliance_admin` is checked explicitly.
  - Delete is enabled only for an edition that is inactive and not Approved, which matches
    DELETE `/:id` (forms-admin.routes.ts:761-766).
  - Approve requires Reviewed (`transitionWorkflow`), and Activate requires Approved and
    inactive.
  - `useAuth()` is called at the top level of the component before the only `return`, so
    hook order is stable.
- Tests against the committed snapshot: I exported the tree with `git archive HEAD` to a
  scratch directory and symlinked `node_modules`.
  - `form-selection.test.ts`, `forms.service.test.ts` and
    `document-generation.service.test.ts` pass.
  - `form-attachment.service.test.ts` passes except for the field-catalog case, which fails
    only because the export does not include product config. The same case passes in the
    repository.
  - `FormsManagementPage.lifecycle.test.tsx` passes (4 tests).
- Mutation check: I put back the pre-fix `document-generation.service.ts` (`ee9224a^`).
  The new NY-only/expired test and the `['Bind']@NB` and `['Issue']@NB` stage tests then
  fail. The first lifecycle UI test would fail on the old `!canEdit` gate, because Activate
  was disabled for an Approved, edit-locked edition.
- E2E pilot spec (`19d0639`): matching on the URL path and choosing Download or Open by
  content type fits `PolicyDocumentsPanel.tsx:119`. Blob capture through
  `createObjectURL` covers both flows.
- Mockup escaping (`0d8bf15`): this only affects the mockup. The view allow-list and
  `clean()` close the CodeQL paths.

Not verified: the PostgreSQL integration suites, Docker and E2E runs. I relied on the
developer's reported results for these and did not reproduce them.

### Findings

| # | Severity | Location | Defect and failure scenario | Fix | Outcome |
| --- | --- | --- | --- | --- | --- |
| A | Minor | server/src/routes/forms-admin.routes.ts:829-831 vs server/src/services/form-selection.ts:52 | Activation counts only `Approved` jurisdictions, but the shared gate now treats `Filed` as usable. Scenario: a form that requires approval and has only Filed rows (file-and-use states) would attach, but the compliance admin gets "Activation requires at least one approved jurisdiction". | Use the same usable-status set (Approved/Filed) in activation, or remove Filed from the gate. Decide one rule and record it in the forms knowledge doc. | Returned (P2) |
| B | Minor | frontend/src/features/wizard/QuoteWizard.tsx:214 and forms.service.ts `isPreviewApplicabilityMatch` | The Quote preview sends `transactionType: 'Quote'`. The code comment says the Quote list should show "what binding will attach", but Bind-scoped forms are hidden and Quote-only forms (which generation never attaches) are shown. This existed before the fix (exact `'Quote'` match), but it contradicts the "never previews one way and attaches another" claim in form-selection.ts. | At Quote, filter on the Bind scope, as the rule stage already does, or label the list as quote-stage forms. | Returned (P2) |
| C | Minor | server/src/services/__tests__/form-attachment.service.test.ts:135-151 | The unit tests mock `q` and pass ready-shaped `jurisdictions` and `require_approved_jurisdiction` values, so they do not test the rewritten SQL. A wrong key in `jsonb_build_object` or a dropped `f.require_approved_jurisdiction` would still pass. Integration fixtures only cover the positive CA-Approved case. | Add one PostgreSQL case to form-attachment-rules.integration.test.ts: a form approved only in NY is not attached at a CA bind, and a Bind-only form is not attached at Issue. | Returned |
| D | Minor | Release / data | This is an intended behavior change on existing data. Forms that require approval now stop attaching where no Approved or Filed row is in force for the state and date. Before, they attached whenever no row joined, including all 51 ISO state amendatories on every policy and policies dated before 2026-01-01. Admin forms scoped `Issue` (the UI's default draft is "Quote, Issue") no longer print at bind. | Deployment should run a pre-deploy query listing active forms with `require_approved_jurisdiction` and no in-force usable row per written state, and note the Bind/Issue change in the release notes. | Accepted, with a hand-off to stage 10 |
| N1 | Nit | document-generation.service.ts:411 | `String(effectiveDate \|\| '')` compares raw strings. Every current caller passes `YYYY-MM-DD` (bind's payload is checked by `DateOnlySchema`), but a timestamp would leave out the sunset day. The old SQL cast to `date`. | Pass `asDateOnly(effectiveDate)`. | Open |
| N2 | Nit | document-generation.service.ts:362-365 | The subquery returns every state's rows for each form, about 52 per ISO form. | Add `AND ($3 = '' OR upper(j.state_code) IN ($3,'ALL'))` if packet SQL becomes slow. | Open |
| N3 | Nit | forms.service.ts (preview) | Preview reads DATE columns as JS `Date` values, which `asDateOnly` converts through UTC. Generation reads strings. If the server time zone is east of UTC, preview and generation can disagree on boundary days. This existed before the fix. | Confirm the server runs in UTC, or format dates in SQL for preview as well. | Open |
| N4 | Nit | FormsManagementPage.lifecycle.test.tsx | There is no case where Delete is enabled (Draft, inactive) and no case for the `admin` role. | Add both. | Open |
| N5 | Nit | e2e/pilot-product-pinning.spec.ts:58 | The spec uses a regex on `contentType`, but the UI uses an exact match (`archivedOutputFormat`). A content type with parameters would make the spec look for the wrong button. Only the test is affected. | Use the same helper or the same exact values. | Open |
| N6 | Nit | mockups/document-generation.html | Escaped values are stored in state, so mockup search and filters compare escaped text (`A&amp;B`). This affects only the mockup. | Escape when rendering, not when storing. | Open |

Notes on semantics I checked:
- State rows take precedence over ALL rows. When no state is given, any usable row in force
  allows the form; the old generation code did not check at all in that case.
- A Pending row and an Approved row for the same state cannot both be in force, because
  `ensureNoJurisdictionOverlap` prevents overlapping rows per state. So the
  `find(usable)` choice cannot hide a withdrawal.

Result: no open blockers or majors. Findings A-C are returned as P2 follow-ups. D is handed
to Deployment (stage 10).
