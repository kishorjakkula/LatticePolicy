# Design — WP-0009

Gate A approved by Kishor Jakkula with the recommended defaults: no admin override for
self-approval; legacy Open referrals withdrawn automatically at release; expired quotes
refused at bind; m6 and m7 out of scope.

## Options considered

| Option | Benefits | Cost / risk | Decision |
| --- | --- | --- | --- |
| A. Targeted fixes in the existing services, one migration for the legacy referral clean-up | Small, reviewable changes on code the #394 review already mapped | Several areas in one PR | **Selected** |
| B. Split into one PR per finding | Smaller PRs | About 10 PRs of review overhead for small fixes; ordering risk | Rejected |
| C. Rebuild referral premium as a stored column | Fast queries | Migration and backfill; the stored proposal already holds the right figure | Rejected; read from `proposal_snapshot` |

## Components touched

1. **REQ-1, `uw-referral.service.ts` `referralPremium` / `REFERRAL_VIEW_SELECT`:**
   - The premium comes from `proposal_snapshot->'premium'->'total'`. Every proposal carries the full premium of the proposed transaction: `newPrem` for endorsements, `prem` for renewals and rewrites, the quote premium for new business.
   - Next fallback: the referral's quote premium.
   - Otherwise null ("Not rated").
   - The policy-latest-version lateral, the source of the deltas, is removed.
2. **REQ-2, `quote-bind.service.ts`** (the referral proposal for new business): the proposal's underwriting carries `aggregation: { configured, exceeded, reasons }` only, not projected totals. Bind keeps evaluating aggregation itself.
3. **REQ-3, WP-0004 records:**
   - `status.json` via the flow: record Gate C as approved through the merges of #392 and #394.
   - `05-implementation.md`: an honest Phase 2/3 summary.
   - `06-unit-tests.md`: the stale header corrected.
   - `07-code-review.md`: a "Phase 2/3 post-merge review" entry with the 2026-10-23 findings (file:line, failure scenario, outcome: fixed in WP-0008 or WP-0009, or deferred).
4. **REQ-4, `compliance-admin.routes.ts` `PATCH /eligibility/:id`:**
   - When `status` changes, `reason` is required (400 `REASON_REQUIRED`).
   - The update runs `FOR UPDATE` in one transaction with a `ledger_events` row (same shape as `/bulk`: reason, before, after, actor).
5. **REQ-5, new `server/src/lib/underwriting-company-scope.ts` `assertCompanyWritesProduct(q, tenantId, payload)`:**
   - Called by rating (`createOrRateQuote`) and bind.
   - When the payload names an underwriting company (`underwritingCompanyId` or `underwritingCompanyName`), there must be an active `underwriting_companies` row for that tenant, company, product, country and state.
   - Otherwise 400 `UNDERWRITING_COMPANY_NOT_ELIGIBLE`.
   - A quote with no company named keeps today's behaviour.
6. **REQ-6, `uw-referral.service.ts` `decideReferral`:**
   - Approve by the referral's `created_by` (same user id) gives 403 `SELF_APPROVAL_NOT_ALLOWED`; decline and info-request stay allowed.
   - `getReferral` adds `priorDecisions`: referrals in the same tenant with the same `proposal_hash`, a different id, and status Approved, Declined or Withdrawn, with date, decider and reason.
7. **REQ-7, migration `071_withdraw_legacy_open_referrals.sql`:**
   - Number 070 is taken by the other session's uncommitted AI branch, so this is 071. The migration runner applies by version and tolerates gaps.
   - It updates Open referrals with `proposal_hash IS NULL` to `Withdrawn`, adds a comment "Superseded by proposal-bound referrals" and writes `ledger_events`.
   - Forward-only and idempotent.
8. **REQ-8, `frontend/src/components/AppNav.tsx`:**
   - The phone sheet traps nothing, but focus moves to its first link when it opens.
   - Escape closes it and returns focus to the toggle.
   - `aria-controls` is set only while the sheet is open, or the sheet stays in the DOM with `hidden`.
9. **REQ-9, `uw-referral.service.ts` `mapRow`:** DATE values are converted with local date parts (node-postgres parses DATE as local midnight). The `sameDate` check uses that, and the `INSERT … RETURNING` paths use the same mapping.
10. **REQ-10, `decideReferral`:** a non-string `reason` gives 400 `INVALID_REASON`, before `trim`.
12. **REQ-12, Issued recorded by the server:**
    - Issue and the policy-transaction requests (endorse, cancel, reinstate, renew, rewrite) gain an optional `quoteId`; the wizard sends its draft's id (today it sends none).
    - When present, the service sets that quote's status to Issued in the same transaction, scoped to the tenant (`tenant_id = $1`) and only if the quote is not Converted.
    - An unknown or other-tenant quote id is ignored, so the transaction never fails because of it.
    - `updateDraftQuote` then refuses a client "Issued" (back to the Gate A answer).
    - The wizard stops sending it.
13. **REQ-13, `createOrRateQuote` with a quote id:** locks the quote row and refuses Converted or Issued with 409 `QUOTE_ALREADY_BOUND`.
14. **REQ-14, logging:**
    - `logger.warn({ tenantId, quoteId, code }, 'bind refused')` on `QUOTE_RERATE_REQUIRED` and `QUOTE_EXPIRED`;
    - `logger.info({ tenantId, quoteId }, 'quote rating reset')` on a reset;
    - no payload or personal data.
11. **REQ-11, `quote-bind.service.ts`:**
    - The early load selects `status` and `expiry_date`. Status Expired, or `checkQuoteExpiry` reporting expired (now given the real `expiry_date`), gives 409 `QUOTE_EXPIRED`.
    - The same check runs under the lock.

## Data and migrations

- One forward-only migration, 071 (REQ-7). It changes data only, no schema, and is idempotent through `WHERE status='Open' AND proposal_hash IS NULL`.
- RLS on `underwriting_referrals` is unchanged. The migration runs as the migration role, writing per tenant rows with their own `tenant_id`.
- Rollback: Withdrawn referrals stay withdrawn, since they could never be approved; the code changes revert normally.

## API contract

| Route | Change |
| --- | --- |
| `GET /v1/uw/referrals`, `GET /v1/uw/referrals/:id` | `premium` from the proposal; detail adds `priorDecisions: [{referralId, status, decidedAt, decidedBy, reason}]` |
| `PATCH /v1/uw/referrals/:id/decide`, `/approve` | 403 `SELF_APPROVAL_NOT_ALLOWED`; 400 `INVALID_REASON` |
| `PATCH /v1/admin/compliance/eligibility/:id` | `reason` required when `status` changes (400 `REASON_REQUIRED`); audited |
| `POST /v1/quotes`, `POST /v1/quotes/:id/bind` | 400 `UNDERWRITING_COMPANY_NOT_ELIGIBLE`; bind 409 `QUOTE_EXPIRED` |

All join the OpenAPI inventory with their error codes.

## Security, tenancy and audit

- Every new query is tenant-scoped: the company lookup, the prior-decisions lookup and the eligibility update.
- Self-approval compares server-side user ids only.
- The prior-decisions lookup returns only the same tenant's referrals with the identical proposal hash.
- Audit: the eligibility PATCH writes `ledger_events`; legacy withdrawals write `ledger_events`.
- Reasons are stored as before and are not logged.

## Performance, operations and configuration

- The company check is one indexed query (`underwriting_companies(tenant_id, product_code, country_code, state_code, active)`).
- The prior-decisions query is indexed on `(tenant_id, proposal_hash)`; added in 071 if missing.
- Release note: list the count of withdrawn legacy referrals per tenant (the migration logs it).

## Requirement mapping

| Requirement | Design element |
| --- | --- |
| REQ-1 | Proposal-snapshot premium in the referral view |
| REQ-2 | Aggregation summary only in the proposal |
| REQ-3 | WP-0004 status, 05/06/07 corrections |
| REQ-4 | Eligibility PATCH reason + ledger |
| REQ-5 | `assertCompanyWritesProduct` at rate and bind |
| REQ-6 | Self-approval 403; `priorDecisions` |
| REQ-7 | Migration 071 |
| REQ-8 | AppNav phone-sheet focus and Escape |
| REQ-9 | Local-date DATE mapping in the referral service |
| REQ-10 | Reason type check |
| REQ-11 | Bind expiry refusal (status and `expiry_date`) |
| REQ-12 | Server-recorded Issued; client Issued refused |
| REQ-13 | Re-rate refuses bound or issued quotes under lock |
| REQ-14 | Structured refusal and reset logs |

## ADR

None.
