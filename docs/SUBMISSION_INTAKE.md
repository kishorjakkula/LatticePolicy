# Submission Intake

AI-assisted intake of broker submissions. A reader (an AI model or the
built-in label reader) drafts the data for a quote from the broker's email
and documents. A person checks every value against its source and approves.
Only approval creates the customer and the draft quote.

Code: `server/src/lib/intake/`, `server/src/services/submission-intake.service.ts`,
`server/src/routes/submissions.routes.ts`, `frontend/src/features/submissions/`.
Migration: `server/migrations/060_submission_intake.sql`.

## Principles

1. **The AI proposes, a person decides.** Extraction writes only to
   `submission_fields`. It never creates or changes a customer, quote, or
   policy.
2. **Every value shows its source.** Each drafted value carries the document,
   line or page, and the exact quoted text. The server checks quotes against
   the document text; a quote that is not in the document caps the value at
   low confidence, so an invented value cannot arrive as "high confidence".
3. **Confidence is shown in words and color.** High, medium (check), low
   (check), not found, documents disagree. AI-drafted content is marked in
   violet with an "AI" label throughout the UI.
4. **Approval is a gate, and it is atomic.** It needs every value confirmed,
   all required values present, and the reviewer's attestation. The customer
   link, the draft quote, and closing the submission happen in one database
   transaction; any failure leaves nothing created.
5. **Rules come from the carrier, not the AI.** Clearance uses the customer
   duplicate matcher; appetite uses the product's underwriting rules
   (`evaluateUW`). The UI says so.
6. **Everything is recorded.** `submission_events` keeps who did what: the
   reader's draft (actor type `ai`), each confirmation and edit with the AI
   value it replaced, the approval with its attestation text, and what
   LatticePolicy created (actor type `system`).

## Lifecycle

```
RECEIVED → READING → READY_FOR_REVIEW → IN_REVIEW → COMPLETED
                  ↘ READ_FAILED  (try again, or fill in by hand)
any open state → DECLINED (reason required)
```

- A read that has not finished after 15 minutes may be restarted.
- Reading again replaces the drafted values; the UI warns how many
  confirmations it discards.
- A run whose token was superseded by a newer read writes nothing.

## What gets drafted

The target fields come from the framework, not from intake code:

- `productCode`, plus the policy, insured, and broker fields every quote
  needs (`target-fields.ts`).
- The product's risk fields from `buildRiskFields`, the same list the quote
  wizard renders, including carrier pack fields and option lists. A carrier
  that adds a field to its product gets it in intake with no code change.

Values are normalized to what the quote stores: ISO dates, plain numbers, a
listed option, two-letter state codes (`normalize.ts`).

If the reviewer changes the product, that product's risk fields replace the
old ones (empty), and the UI offers to read the documents again for it.

## Readers

| `INTAKE_AI_PROVIDER` | Reader | Reads | Documents leave the stack |
| --- | --- | --- | --- |
| `builtin` (default) | Label matcher ("Applicant: …") | Text, email, Word, Excel, CSV | No |
| `anthropic` | Claude via the Messages API, forced tool call | Also PDFs and images | Yes, to the Anthropic API (or `INTAKE_AI_BASE_URL`) |

The built-in reader needs nothing and suits self-hosted carriers that cannot
send documents out. It does not understand free text, and says so in its
summary.

Settings (see `docs/PRODUCTION_RUNTIME_CONFIGURATION.md`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `INTAKE_AI_PROVIDER` | `builtin` | `builtin` or `anthropic` |
| `ANTHROPIC_API_KEY` | none | Required for `anthropic` |
| `INTAKE_AI_MODEL` | `claude-sonnet-5-5` | Model id |
| `INTAKE_AI_BASE_URL` | `https://api.anthropic.com` | API base, for a gateway |
| `INTAKE_AI_TIMEOUT_MS` | `180000` | Per read |
| `INTAKE_EXTRACTION_MODE` | automatic | `job` (batch worker) or `inline` (API process) |

`GET /api/v1/submissions/settings` returns the reader label, whether it
sends documents off the stack, and the attestation text. It never returns
the key.

The prompt tells the model to record only what the documents state, to quote
its source exactly, to list disagreements as conflicts, and to treat document
text as data, never as instructions. Its tool output is validated: unknown
fields and documents are dropped, and quotes are verified as above.

## Where reading runs

`submission-intake-scheduler.ts` queues a `submission_extract` job when the
batch worker runs separately (`LATTICE_ROLE=api`) or in-process
(`JOB_WORKER_ENABLED`). Otherwise the read runs in the API process right
after the upload request returns. `INTAKE_EXTRACTION_MODE` overrides.
Failures are recorded on the submission (`READ_FAILED` with the message),
not retried.

## Approval

`POST /submissions/:id/approve` with `{ "attestation": true }`:

1. Checks: open for review, every value confirmed, required values present,
   product installed.
2. Customer: the reviewer's chosen existing customer, or a new one created
   with the customer service's duplicate check. A likely duplicate stops the
   approval (`409 POTENTIAL_DUPLICATE`); the reviewer picks the existing
   customer instead. Creating a duplicate anyway stays an administrator
   decision, as in the quote wizard.
3. Draft quote: built only from confirmed values (`buildQuotePayload`), with
   `payload.intake` linking back to the submission, at wizard step 4 (risk),
   so the user continues with coverages and rating. Rating, product pinning,
   and underwriting rules then run exactly as for any quote.
4. The submission becomes `COMPLETED` with the customer and quote ids.

## Permissions

| Permission | Who by default | Allows |
| --- | --- | --- |
| `menu.submissions.view`, `page.submissions.view` | admin, underwriter, agent | Inbox and review pages |
| `submissions.read` | admin, underwriter, agent | List, detail, documents, checks |
| `submissions.manage` | admin, underwriter, agent | Upload, read, confirm or correct values |
| `submissions.approve` | admin, underwriter | Approve, decline |

Agents can prepare a submission but not approve it. Migration 060 adds the
permissions to existing tenants' system `underwriter` and `agent` roles that
already hold grants.

## Limits

- 10 documents per submission, 10 MB each. Files are stored in Postgres
  (`submission_documents.content`).
- `.eml` attachments are not unpacked; upload them as separate files.
- One risk per quote, as in the quote wizard for these products; vehicle or
  location schedules are not yet drafted as lists.
- No email inbox connector yet: submissions arrive by upload or the API.
