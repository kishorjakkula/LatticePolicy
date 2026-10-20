# Implementation - WP-0003

Status: forms master-data/transaction-document slice implemented and tested.
The complete enterprise work package remains in development; do not mark its
developer stage complete based on this scoped handoff.

- Branch: `latticepolicy/forms-master-attachment-rules`.
- Task note: `docs/tasks/forms-attachment-rules.md`.
- Design approval: Gate B, Kishor Jakkula, exact words in `status.json`.

## Files Changed

- `packages/rules/src/form-attachment.ts`, exports and tests: safe bounded
  snapshot context, condition/suppression evaluation, transaction normalization,
  premium/coverage/business aliases, custom fields and sensitive-path denial.
- `server/src/services/form-attachment.service.ts`: metadata-only field catalog,
  installed-product validation, explicit legacy opt-in and safe domain errors.
- `server/src/routes/forms-admin.routes.ts`: draft-only locked/audited rule
  authoring, safe expression testing, shared preview and compact catalog scope
  projections. Previously disabled JavaScript evaluator code is removed.
- `forms.service.ts` and `document-generation.service.ts`: shared selection
  conditions; rule provenance and stage pinned into form snapshots.
- Lifecycle, quote-bind and endorsement services: transaction premium, policy
  term/status and underwriting facts supplied consistently for generation.
- Policy service/routes and persistence: exact transaction/version archive
  projections, scoped downloads without implicit re-render, worksheet SQL
  version linkage and protected historical form snapshots.
- Frontend forms administration and new `features/admin/forms/` components:
  four-section editor, product/state filtering, field picker, safe rule editing,
  synthetic candidate tests, stale-result invalidation and explicit supported
  upload formats. List summaries avoid one detail request per catalog row.
- Policy documents panel and transaction wizard: pinned historical forms,
  exact archived output downloads, normalized live preview payloads and clear
  readiness/format states. No current-template reevaluation in read-only views.
- Unit/component/API tests, disposable PostgreSQL fixture/integration tests,
  three Playwright specs and root integration-runner opt-in compatibility.

## Scope And Deviations

This slice uses existing form master-data tables; no migration or dependency
version changes are required. Existing safe PDF/DOCX upload remains available;
unsupported XLSX/fillable-PDF uploads are not advertised as implemented.
Carrier fields are accessible through supplied business snapshots, not arbitrary
database queries. Credentials and sensitive authentication-style fields remain
excluded. No external AI/converter is introduced.

The larger approved design still requires the independent coordinator/intents,
bounded format workers, certified conversion/assembly, immutable package
publication, export workflows, restore/operations tooling and carrier-approved
load/soak qualification. Existing legacy template approval exceptions are not
replaced by independent package governance in this slice.

Legacy trigger rows remain inert until explicitly replaced with safe rules.
New historical projections do not fabricate missing legacy archive/version
provenance. Missing/corrupt archives now fail closed on normal GET; controlled
restoration remains a separate workflow.

## Checks

Supported Node 22 was used. See `06-unit-tests.md` and `09-automation-tests.md`
for final counts, scope and failed-run corrections. Independent review evidence
is in `07-code-review.md`; no human gate is approved by the reviewer.

Real PostgreSQL tests used disposable containers/databases only. The root
container test runner explicitly identifies its disposable integration database;
standalone form-rule tests otherwise create their own container and ignore
inherited DATABASE_URL. Test containers were cleaned up. The running demo/pilot
stacks and their databases were not modified.

No commit, PR, merge, production deployment or carrier acceptance is implied.

Subsequent user-authorized local deployment is recorded in `10-release.md`.
The latest review (`docs/tasks/wp-0003-latest-implementation-review.md`) identifies
remaining applicability/activation blockers despite passing full browser and
host-browser database regressions. Those findings have not been fixed in the
review turn and prevent release-readiness claims.

## Review Fixes - 2026-10-19

Fixes for the second review in `07-code-review.md`:

- Rule context: bounds raised above what the 25 MB API body can carry; shared
  subtrees copied once; built once per transaction and only when an opted-in
  form needs it; built contexts are not copied again during evaluation.
  Oversized data fails with 422 `FORM_ATTACHMENT_CONTEXT_TOO_LARGE`, malformed
  data with 422 `FORM_ATTACHMENT_CONTEXT_INVALID`; rule faults keep
  `FORM_ATTACHMENT_RULE_INVALID`.
- `attachmentRulesVersion` is server-owned on form create and `PATCH /:id`;
  PATCH locks the form row and replaces metadata only when the request sends it.
- `transaction.stage` exists for new business only. `uw.isBound`/`isIssued` for
  servicing transactions follow the policy. The wizard's Quote list and the admin
  scenario test evaluate at Bind, since nothing is generated at Quote.
- Unknown transaction types are rejected (`parseValidationTransaction`); `bind`
  and `quotebind` were added as new-business aliases.
- Pinned rule snapshots hold only ID, type, expressions, priority and active.
- Editor wording: "Never attach the form when", with form-wide help text.
- Tests: rule engine, adapter, selection, wizard preview and a new PATCH
  integration test; task note updated.
- Results (Node 24.21, host): typecheck pass; packages 218, server 728,
  frontend 354 passed; form-attachment PostgreSQL suite 73 passed; the six
  document/lifecycle integration files 29 passed; E2E (three specs) 6 passed.
  The root container runner (`node:22-alpine`) failed 26 integration tests,
  all caused by Puppeteer finding no Chrome in that image (lifecycle tests fail
  through document generation). The same files pass on the host. This image
  gap predates these fixes.

## Fixes For The Independent Review - 2026-10-19

- Major (API exhaustion): every value and reference now counts toward a
  500,000 cap (was 5,000,000 objects only). Measured: a 4.9M-object body is
  rejected in about 0.4 s; just under the cap builds in about 0.7 s. The built
  context is frozen, closing the mutable-shortcut finding.
- Cancellation passes `priorStatus`; the wizard does the same. Scenario test
  defaults its stage. Preview rejects unknown types and maps NonRenewal.
- PATCH: non-object metadata is 400; key-order-insensitive change detection.
- UI wording updated; the evaluate-once test now counts rule reads.
- The doubling-structure note (finding 6) is unchanged: copying stays linear
  because shared copies are reused and evaluation follows fixed paths.
- Re-check minors fixed: preview accepts the rules engine's new-business names
  (NB, new_business, QuoteBind) and rejects only unknown types (A);
  `priorStatus` is read only from the caller's explicit policy input and only
  for cancellation (B); create rejects non-object metadata (C).
- Final results: rules 221, server 728, frontend 354 passed; typecheck pass;
  attachment PostgreSQL suite 75 passed; E2E 6 passed (before A-C, UI unchanged).

## P1 Fixes From `docs/tasks/wp-0003-latest-implementation-review.md` - 2026-10-19

- P1-1 jurisdiction bypass: generation now applies the form's
  `require_approved_jurisdiction` and evaluates all of its jurisdiction rows
  in JS through `formJurisdictionDecision` (shared with preview). Preview now
  also accepts Filed, as generation already did.
- P1-2 stage applicability: `formTransactionMatches` (shared) maps NB to Bind
  and Issue to Issue; generic new-business scopes match every NB stage;
  unknown configured names match nothing (preview previously ignored them).
- P1-3 UI: lifecycle buttons depend on workflow state and compliance
  permission (`admin.forms.approve` or compliance_admin), not edit-lock.
- Also: pilot document E2E updated for scoped download URLs and direct
  DOCX/XLSX downloads; mockup CodeQL js/xss-through-dom fixed.
- Results: typecheck pass; rules 221, server 765, frontend 358 passed;
  attachment PostgreSQL suite 75; full host integration 38 files / 256 passed;
  E2E document specs 6 passed. P2 findings remain open.

## P2 Fixes And P1 Review Minors - 2026-10-19

- P2-4: preview applies endorsement change criteria through the shared
  `matchesEndorsementChanges` (moved to form-selection.ts). The endorsement
  preview API returns `endorsementChanges`, and the wizard sends it with its
  form preview; before rating, only always-attach endorsement forms preview.
- P2-5: catalog product/state filters follow generation scope (line-of-business
  fallback for forms without applicability rows, ALL states, jurisdiction-less
  forms that don't require approval). Blank-product rows match nothing in
  generation, catalog and preview alike.
- P2-6: the Quote list projects bind (Bind scope, Bind stage, Bound status) and
  is labelled "Quote (attaches at bind)".
- P2-7: `npm run test:integration` builds a test-only runner image with
  Alpine Chromium (scripts/integration-test-runner.Dockerfile).
- P1 review minors: activation accepts Filed like the gate; generation uses
  asDateOnly; a PostgreSQL test covers NY-only, expired, Filed and Bind/Issue
  scope; release impact and pre-deploy queries are in the task note.
- Results: typecheck pass; rules 221, server 777, frontend 369 passed;
  Docker integration 38 files / 258 passed; E2E (forms, documents,
  transaction documents, quote wizard) 12 passed.
