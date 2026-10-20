# Forms Master Data And Attachment Rules

Work package: WP-0003. Branch: `latticepolicy/forms-master-attachment-rules`.
This is an implementation slice, not completion of enterprise document readiness.

## Behavior

The existing `/admin/forms` catalog uses product/state filters and four edition
sections: Details & scope, Template, Attachment, Test & publish. PDF/DOCX uploads
retain existing server validation. Excel and fillable-PDF upload are not enabled.
Policy Forms & Documents remain inside the existing transaction wizard.

`packages/rules/src/form-attachment.ts` supplies a bounded shared-parser engine,
not JavaScript execution. Both administrative scenario preview and policy
generation use it. Suppression is form-wide: any rule's "Never attach the form
when" condition keeps the form off, even if another rule matches. Invalid
configured rules fail generation rather than silently dropping a form.

Rules can reference the safe transaction snapshot: `payload.*`, `quote.*`,
`risk.*`, `risks.0.*`, `insureds.*`, `coverages.A.limit`, `premium.total`,
`transaction.type`, `transaction.stage`, `policy.*`, `attributes.*` and `uw.*`.
Carrier-defined fields need no code change, for example
`payload.customFields.requiresNotice == true`. Dotted array indexes, not JavaScript
brackets, are supported. Transaction types use the validation vocabulary
(`new_business`, `endorsement`, `cancellation`, etc.); an unrecognized type
fails with `FORM_ATTACHMENT_CONTEXT_INVALID` instead of defaulting to new
business. `transaction.stage` (`Bind` or `Issue`) exists for new business only;
endorsements, cancellations, reinstatements, renewals and rewrites have no stage,
so `transaction.stage == 'Issue'` means issuance of a new policy. Nothing is
generated at Quote: the wizard's Quote list shows what binding will attach.
`premium.total` is the transaction premium, including negative cancellation or
endorsement adjustments, not a guarantee of full-term premium.

The context is sanitized, descriptor-only and bounded; secrets, authentication
material, prototype paths and sensitive credential-style keys are excluded.
"All fields" means supplied business snapshot fields, not unrestricted database
queries or access to another tenant. The field picker returns metadata only.
Missing values remain missing; use `isSet(...)` where appropriate.
Legacy `attributes` aliases derive from the first risk plus common policy input;
`uw` includes stored answers and `isBound`/`isIssued` flags: from the stage for
new business; for servicing transactions the policy is bound, and issued unless
its status is still Bound.

The context is built once per transaction, and only if an opted-in form needs it.
A subtree shared by several roots is copied once, and the built context is
frozen so evaluation reuses it without another copy. Bounds: 500,000 values and
references in total, 100,000 items per list or object, depth 64, 50 MB of text.
They keep any request body (including the wizard's `/forms/preview`) under about
a second and a few hundred MB, while schedules such as 5,000 locations x 50
fields still evaluate. A policy beyond them fails with 422
`FORM_ATTACHMENT_CONTEXT_TOO_LARGE`, not a form-configuration error. Preview
rejects an unknown transaction type with 400 `INVALID_INPUT`. Cancellation
passes `policy.priorStatus`, so `uw.isIssued` is false for a bound, never-issued
policy. The admin scenario test defaults to the Bind stage (Issue for Issue). Pinned
form snapshots record only each rule's ID, type, expressions, priority and
active flag, not catalog audit columns.

## Selection Scope (Shared By Preview And Generation)

`server/src/services/form-selection.ts` decides transaction scope and the
jurisdiction gate for both the preview and generation:

- Transaction scope: generation passes NB at bind and Issue at issue. A form
  scoped to `Bind` attaches only at bind and `Issue` only at issue; a generic
  new-business scope (`NB`, `new_business`) attaches at Quote, Bind and Issue.
  Empty scope applies to every transaction; an unrecognized configured name
  matches nothing.
- Jurisdiction: rows in force on the effective date decide, state-specific rows
  ahead of `ALL`. Approved or Filed allows the form (Filed covers file-and-use
  states); Pending or Withdrawn blocks it. With no row in force, the form
  attaches only if it does not require an approved jurisdiction. A form approved
  only in NY, or whose approval expired, no longer attaches to a CA transaction.
- Admin lifecycle actions (Approve, Activate, Deactivate, Delete) follow
  workflow state and compliance authority, not content edit-lock.

## API And Compatibility

- `GET /admin/forms/attachment-fields?productCode=...`: field metadata.
- Existing `/:id/triggers` POST/PATCH/DELETE: forms-editor authorization,
  tenant scope, inactive-Draft-only mutation and audit in one transaction.
- Existing `/admin/forms/preview`: same selector as wizard preview; draft
  evaluation requires an explicit form ID. Client flags cannot enable drafts
  through the public wizard endpoint.
- Existing `/admin/forms/test-expression`: shared expression parser only.
- `metadata.attachmentRulesVersion` is server-owned: only rule authoring sets
  it. `PATCH /:id` keeps the stored value, and replaces metadata only when the
  request includes it (the UI's details save does not).

Previously disabled trigger rows remain inert unless the edition explicitly
sets `metadata.attachmentRulesVersion: 1` through safe authoring. Existing
legacy rows must be deleted and re-authored first. No-active-rule opted-in forms
do not attach; ordinary legacy applicability retains previous behavior. Clones
copy only safe opted-in rules. No migration or automatic reactivation is used.
Workflow publication and rule edits lock the same edition row.

Selected form snapshots retain rule definitions/IDs and attachment stage.
Historical transaction views use pinned forms and exact version/transaction
document references. Downloads verify archived bytes; a missing/corrupt original
is unavailable, never silently re-rendered on GET. Legacy records without enough
archive provenance may need a controlled restore/migration process.

## Tests

Use supported Node 22.12+ from repository root:

```sh
npm run test:packages
npm run test:frontend
npm run test:server
npm run typecheck
npm run build
npm run test:integration --workspace=server -- src/__tests__/form-attachment-rules.integration.test.ts
npm run test:e2e:isolated -- e2e/forms-management.spec.ts e2e/policy-documents.spec.ts
```

The new integration test normally owns a disposable PostgreSQL container and
ignores inherited DATABASE_URL. The root container runner explicitly sets
`LATTICE_DISPOSABLE_TEST_DATABASE=true`; this allows only the exact
`lattice_policy_integration` database on a local host and needs no nested Docker
socket. Cleanup removes only the fixture's random tenants. Never point tests at
demo/pilot databases.
Final run evidence and review findings belong in the WP implementation handoff.

## Remaining Work

The approved WP also includes independent document coordination, bounded render
workers, certified PDF/Word/Excel graph capabilities, immutable package promotion,
exports, archive restore, operational tooling and carrier workload qualification.
These are not implemented by this slice. Existing legacy template-governance
exceptions are not equivalent to independent package approval. Human merge and
business-release gates remain required; no production deployment is authorized.
