# Task Note: AI-Assisted Submission Intake

## Links

- Issue: none yet
- Pull request:
- Design: canvas "AI Submission Intake" (inbox and review workspace)

## Summary

Broker submissions (email, ACORD forms, schedules, loss runs) are uploaded,
read by a reader that drafts the quote data with its source and confidence,
reviewed value by value, and approved by a person. Approval creates or links
the customer and creates a draft quote in one transaction. Nothing outside
the submission is created before approval. Full description:
`docs/SUBMISSION_INTAKE.md`.

## Important Files

- `server/migrations/060_submission_intake.sql`: submissions, documents,
  fields, events (all with tenant RLS); permissions; the on-demand
  `submission_extract` job definition.
- `server/src/lib/intake/target-fields.ts`: fields to draft, from the
  product's own risk fields (carrier pack aware).
- `server/src/lib/intake/document-text.ts`: text lines from email, text,
  Word, Excel.
- `server/src/lib/intake/extractors.ts`: built-in reader, Claude reader,
  model output validation and quote verification.
- `server/src/lib/intake/normalize.ts`: values to stored form.
- `server/src/services/submission-intake.service.ts`: lifecycle, review,
  checks, the approval transaction.
- `server/src/services/submission-intake-scheduler.ts`,
  `server/src/jobs/handlers/submissionExtract.ts`: where reads run.
- `server/src/services/quote.service.ts`: `insertDraftQuote` (draft insert in
  the caller's transaction; `createDraftQuote` now wraps it). The insert uses
  a savepoint so a quote-number collision retries instead of aborting the
  transaction.
- `server/src/routes/customers.routes.ts`: `findPotentialMatches` exported for
  clearance.
- `frontend/src/features/submissions/`: inbox, review workspace, approval
  dialog.

## Behavior Rules

- Extraction writes only `submission_fields` and the submission's own status
  and summary. Never customers, quotes, or policies.
- A drafted value's quote is checked against the document text; an
  unverifiable quote in a text document caps it at low confidence.
- `ai_value` is never changed after extraction; `value` is the reviewer's.
  Editing a confirmed value takes the confirmation back.
- Approval requires every field accepted, required values present, the
  attestation, and `submissions.approve`. It runs in one transaction.
- A likely duplicate customer blocks approval unless the reviewer links the
  existing customer; creating a duplicate anyway is not offered here.
- Appetite and clearance come from carrier rules and records, not the AI.
- All reads and writes go through `withTenantTx`; tables have RLS policies.
- The settings endpoint never returns the API key.

## Automated Tests

- `server/src/lib/intake/__tests__/intake.test.ts` (unit): normalization,
  document reading, target fields, built-in reader, quote verification,
  Claude request shape and output validation with a stubbed fetch, reader
  selection.
- `server/src/__tests__/submission-intake.integration.test.ts` (database):
  nothing created before approval, approval gates, atomic approval, duplicate
  handling, superseded reads, tenant isolation, decline, failed reads, upload
  validation.
- `frontend/src/features/submissions/__tests__/SubmissionReviewPage.test.tsx`
  (component): AI labeling, confidence text, source highlighting, approval
  locked until all confirmed, attestation, approver permission, states.

## Validation

```bash
npm run test
npm run typecheck
npm run build
npm run check:architecture
npm run test:integration --workspace=server   # fresh Postgres
```

## Follow-Ups Or Risks

- Email inbox connector (IMAP or provider webhook) and ACORD XML API intake.
- Schedules (vehicles, locations) drafted as lists once list fields reach
  core products.
- `.eml` attachments are not unpacked.
- Documents are stored in Postgres; move to document storage if volumes grow.
- The Claude reader was tested with a stubbed API, not against the live API.
