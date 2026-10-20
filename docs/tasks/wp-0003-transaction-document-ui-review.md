# WP-0003: Transaction Document UI Review

## Request And Scope

The product owner clarified that the new document design must be embedded in
each existing transaction flow. This is a design/mockup revision only, pending
renewed Gate B approval. No production React/API/schema change or deployment.

## Findings

`PolicyViewPage.handleOpenVersion` already navigates from transaction number to
the read-only transaction wizard with policy/version/transaction context.
`QuoteWizard` already has step 8 Forms & Documents with adjacent Forms and
Documents tabs. `PolicyDocumentsPanel` is a policy-wide index displaying
transaction numbers, not the canonical transaction workspace. Current wizard
PDF handlers include client-side generation, so archive-backed asynchronous
renditions still require implementation; this mockup does not fix that gap.

The document-generation service already carries transaction ID/number and
version ID. Production queries, actions and completion matching must bind
tenant + policy + transaction ID + version ID. Never scope by transaction type
or human-readable number alone; never substitute current policy data for an
issued historical transaction snapshot.

## Revised Design

Remove invented policy-level tabs. Reuse transaction-number entry, the existing
wizard workflow, and step 8 tabs. Enhance the transaction document table/detail
with generation status, PDF/DOCX/XLSX capabilities and archive integrity. Keep
issued transactions read-only. Form/edition configuration stays in Forms
Administration. The existing policy-wide document index can retain reference
links without becoming a parallel generation flow.

Follow-up: `/admin/forms` actually routes to `FormsManagementPage`, which owns
the document catalog/jurisdiction/applicability/upload/preview UI. The generic
`FormsAdmin` field-template screen is not this work's integration target.
See the UI design's Simplified Forms Master Data addendum and DOC-38..41.

## Verification

Run `node docs/work/WP-0003-complete-enterprise-document-generation/mockups/check-mockup.cjs`.
Checks cover separate issue v3/v4 and endorsement v5, transaction-pinned generation,
read-only original protection, Forms/Documents tab navigation, administration
editions, existing operations/export/customer previews and responsive layouts.
These local synthetic checks are not production authorization/enterprise evidence.

## Handoff

See WP-0003 UI design and DOC-37. Gate B must be approved for the corrected
design before production implementation resumes. Do not merge or deploy from
this prototype; retain all pending module/security/performance/release work.
