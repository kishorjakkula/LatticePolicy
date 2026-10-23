# Design — WP-0008

Gate A approved by Kishor Jakkula with the recommended defaults: only billing method and
payment plan may change after rating; client lifecycle statuses are refused; quotes rated
before release are treated as rated once.

## Options considered

| Option | Benefits | Cost / risk | Decision |
| --- | --- | --- | --- |
| A. Rating fingerprint: store a hash of the rated risk data with the rating; reset on change in draft save; verify at bind | Closes both the draft path and any other path that changes the payload; no migration; cheap | Must define the fingerprint carefully so normal autosaves do not reset the rating | **Selected** |
| B. Re-rate and re-run underwriting at bind every time | Always current | Premium could silently change at bind from what the agent quoted; bind slows down; still leaves stale Rated status shown in the wizard | Rejected as the main control; bind still re-checks the fingerprint |
| C. Freeze the payload after rating (refuse any draft change) | Simple | Breaks billing after rating (WP-0004 REQ-8) and normal editing; users would need "unlock" flows | Rejected |

## Components touched

- New `server/src/lib/rating-fingerprint.ts`:
  - `ratingFingerprint(payload)` = sha256 of the canonical JSON (`canonicalProposal` from `lib/referral-proposal.ts`) of the payload after removing:
    - the billing fields `billingMethod` and `paymentPlan`;
    - server-owned keys the rate step adds (`productVersion`, `governanceLineage`, and any others found during development, listed in one constant with a comment).
  - It normalizes through `normalizeQuotePayload` first, so the rate step and the draft step compare the same shape.
- `server/src/services/quote.service.ts`:
  - **Rate (create/re-rate):** stores `underwriting.ratedFingerprint`. The `underwriting` JSON keeps its shape; this adds one key.
  - **`updateDraftQuote`:**
    - Reads the row `FOR UPDATE`.
    - If the stored status is Rated and the new payload's fingerprint differs from `underwriting.ratedFingerprint`, it sets status Draft, sets `underwriting` and `premium` to NULL, and adds a status-history entry.
    - The client `status` field is validated:
      - "Draft" or no value: the server derives the status;
      - "Issued": allowed only when the stored status is Converted or Issued (the wizard's post-issue audit save, `QuoteWizard.tsx:3052,3068`);
      - anything else: 400 `INVALID_STATUS`.
- `server/src/services/quote-bind.service.ts`, before any policy work:
  - The quote must have `underwriting` and `premium`.
  - Its payload fingerprint must equal `underwriting.ratedFingerprint`. A missing fingerprint (rated before release) is accepted once and recorded.
  - Otherwise 409 `QUOTE_RERATE_REQUIRED`, with nothing written.
  - The existing #394 `FOR UPDATE` re-read happens inside the same transaction.
- `server/src/schemas/quote.schema.ts`: `status` stays optional (service-validated); the OpenAPI description lists the allowed values and the new error codes.
- Frontend `features/wizard/QuoteWizard.tsx`:
  - The wizard already discards its local rating when risk data changes. It now also reflects a draft-save response that returns Draft for a quote it believed Rated.
  - A bind 409 `QUOTE_RERATE_REQUIRED` shows "Your changes need a new rating" with Rate again.
- No migration, product pack or deployment change.

## Data and migrations

None. The fingerprint lives in the existing `quotes.underwriting` JSONB. Rollback = revert the
code; stored fingerprints are ignored by older code.

## API contract

- `PATCH /v1/quotes/:id/draft`:
  - Unchanged request shape.
  - 400 `INVALID_STATUS` for a client status other than Draft, or Issued on a converted quote.
  - The response `status` is Draft when the change reset the rating.
  - The response adds `ratingReset: true` in that case, so clients can tell users.
- `POST /v1/quotes/:id/bind`: new 409 `QUOTE_RERATE_REQUIRED`, message "The quote changed after it was rated. Rate it again before binding."
- Permissions unchanged (`page.wizard.view` for draft, existing bind permission).

## Security, tenancy and audit

- All reads and writes stay on `tenant_id = $1` inside `withTenantTx`, with `FOR UPDATE` on the quote row in draft save and bind, so a save and a bind cannot interleave.
- The fingerprint is computed only on the server; nothing from the client is trusted (no client hash, no client status).
- Audit: the rating reset is written to `status_history` with actor and time; the bind refusal is logged with the quote id (no payload).
- Legacy quotes without a fingerprint: accepted once at bind (Gate A default). After release, any draft edit removes their Rated status.

## Performance, operations and configuration

One sha256 over the payload per draft save and per bind (payloads are kilobytes). No new
config. Metrics: count of rating resets and 409s in logs for the first release.

## Requirement mapping

| Requirement | Design element |
| --- | --- |
| REQ-1 | `updateDraftQuote` fingerprint comparison resets status, underwriting and premium |
| REQ-2 | Server-validated client `status` with 400 INVALID_STATUS |
| REQ-3 | Bind fingerprint check → 409 QUOTE_RERATE_REQUIRED before any write |
| REQ-4 | Billing fields excluded from the fingerprint |
| REQ-5 | Wizard reflects `ratingReset` and the 409 with a Rate again prompt |

## ADR

None (an application rule recorded in the task note and `docs/API.md`).
