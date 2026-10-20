# WP-0003: Forms Master-Data Administration Design

## Product Owner Direction

Transaction Forms & Documents UX was accepted. Simplify administration so a
carrier configures product/state-specific forms once: static wording or
policy-populated templates, their own attachment rules, and master-data-driven
attachment to each transaction. Gate B is approved; implementation is in progress.

## Existing Integration Target

`frontend/src/App.tsx` routes `/admin/forms` to
`frontend/src/features/admin/FormsManagementPage.tsx`. This already manages
form metadata, jurisdictions, applicability, template assets/variables,
output/delivery, security and preview. Do not extend the unrelated generic
`FormsAdmin.tsx` just because its name resembles document administration.

The active page supports PDF/DOCX upload and variable feedback. The current
implementation adds the four-section editor and safe conditional attachment
rules. Excel/fillable-PDF upload, independent immutable package governance and
the separate document coordinator remain future work, not capabilities supplied
by the mockup or this initial implementation slice.

## Target Experience

One catalog, filtered by product/state, and four sections per edition:
Details & scope -> Template -> Attachment -> Test & publish.
Static PDF needs no policy mapping; populated templates bind approved policy
fields. Template uploads require real server-side format/security/binding checks.
Attachment selects transaction/stage, condition, ordering, required flag and
per-policy/risk copy scope. Scenario testing shows inclusion/exclusion reasons.
Draft save is not activation. Review/activation controls remain separate and
secondary; current published editions are immutable and cloned for changes.

Only reviewed/activated applicable editions resolve against the transaction
snapshot. Pin form/template/rule versions; do not pull changing live policy data
or silently re-render issued originals. Resolve overlapping state/product/date
selectors deterministically or reject ambiguity. No external AI or rendering
provider receives files or customer data.

## Implementation And Verification

See `docs/tasks/forms-attachment-rules.md` for the application API, shared
expression context, compatibility behavior and automated test commands.
The following checks concern only the earlier mockup:

Run `node docs/work/WP-0003-complete-enterprise-document-generation/mockups/check-mockup.cjs`.
Synthetic local tests include catalog scoping, bad extension, missing mapping,
static-versus-populated controls, condition true/false, date mismatch, review
submission, transaction isolation and responsive layout. No bytes are uploaded
to a service or parsed by a real document engine in this prototype. No
production source files, schema, carrier configuration or deployments changed.

See WP-0003 UI design and DOC-38..41 for implementation/verification follow-up.
