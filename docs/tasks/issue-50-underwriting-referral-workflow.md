# Task Note: Underwriting Referral Workflow

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/50
- Pull request:

## Summary

Replaced the flag-only underwriting referral behavior (a free-text
`overrideReason` on the bind/renew/rewrite/endorse request, checked only on
the client for renew/rewrite/endorse) with a real `underwriting_referrals`
record and decision workflow. A `Refer` decision now opens a referral row
tied to the quote (pre-bind) or policy/transaction (servicing transactions),
and bind/renew/rewrite/endorse are blocked server-side until that referral
has an `Approved` decision from an underwriter-permission actor.

## Important Files

- `server/migrations/038_underwriting_referrals.sql`: new
  `underwriting_referrals` table (tenant RLS, status/priority/reasons/
  assignment/comments/decision columns) linked to quotes, policies,
  transactions, and versions.
- `server/src/schema.ts`: Drizzle definition for `underwritingReferrals`.
- `server/src/services/uw-referral.service.ts`: referral creation/lookup
  (`resolveReferralGate`), the actor-aware gate used by transaction services
  (`resolveReferralGateForActor`), listing, assignment, comments, and
  decisioning (`decideReferral`).
- `server/src/services/quote-bind.service.ts`: bind now calls
  `resolveReferralGateForActor` instead of trusting a client-supplied
  `overrideReason`; throws `UW_REFERRAL_REQUIRED` until a referral is
  Approved.
- `server/src/services/lifecycle.service.ts` (`renewPolicy`,
  `rewritePolicy`) and `server/src/services/endorsement.service.ts`
  (`executeEndorsement`): same gate applied — these transactions previously
  proceeded regardless of an unresolved `Refer` decision; they now block
  until the referral is Approved.
- `server/src/routes/uw.routes.ts`: referral list/detail/assign/comment/
  decide endpoints, plus `/approve` and `/decline` aliases kept for the
  existing UW queue UI.
- `frontend/src/features/uw/UwQueue.tsx`, `frontend/src/api/uw.api.ts`,
  `frontend/src/api/hooks/uw.hooks.ts`: queue UI now lists referrals (not
  just post-bind `policy_versions` rows), supports a status filter, and
  calls the new decide endpoint.

## Behavior Rules

- A `Refer` UW decision opens (or reuses) an `underwriting_referrals` row
  keyed by `quoteId` (pre-bind) or `policyId` + `transactionType` (renew,
  rewrite, endorse). Declined/Withdrawn referrals do not block a fresh
  attempt — a new referral is opened for underwriter review.
- Bind/renew/rewrite/endorse only proceed when that referral's status is
  `Approved`. Every other status (`Open`, `InfoRequested`) blocks with
  `UW_REFERRAL_REQUIRED`.
- An underwriter-permission actor (`roles` includes `underwriter`/`admin`,
  or `permissions` includes `uw.referrals.decide`) supplying a non-empty
  `overrideReason` at submit time self-decides the referral as `Approved`
  inline — this preserves the existing quote-wizard "UW override" UX while
  still recording a real referral + decision (reviewer, reason, timestamp)
  instead of trusting a client-supplied flag. Non-underwriter actors cannot
  bind/submit no matter what `overrideReason` they send.
- `decideReferral` only accepts `Open`/`InfoRequested` referrals; a decided
  referral cannot be re-decided (`REFERRAL_NOT_DECIDABLE`).
- Endorsement was already non-blocking on `Refer` before this change (only
  bind blocked); endorsement now blocks the same way as bind/renew/rewrite.
  Cancellation, reinstatement, and non-renewal do not call `evaluateUW` and
  are unaffected.
- `decided_by`, `created_by`, and `assigned_to` are `uuid` columns — callers
  must pass a real user id, not a username; `resolveReferralGateForActor`
  and the route handlers only populate `decidedBy` when the actor id passes
  `isUuidLike`, otherwise it stays `null`.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/uw-referral.integration.test.ts` (new): quote
    refer -> referral opened -> agent blocked (with and without a free-text
    reason) -> non-underwriter decision forbidden -> underwriter approves ->
    re-decision rejected -> bind succeeds -> referral linked to the bound
    policy/transaction/version; plus underwriter inline self-approve at
    bind time.
  - `frontend/src/features/uw/__tests__/UwQueue.test.tsx` (new): decide
    actions shown/enabled only for decide-permission users on
    Open/InfoRequested referrals, hidden once decided, empty state.
- Test layer used: server DB-backed integration tests (the gate and
  decision workflow are inherently persistence-backed) plus a frontend
  component test for the queue UI permission/status rendering.
- Why this layer is enough: the referral gate's correctness depends on real
  row state transitions (Open -> Approved, FK linkage to policy/transaction/
  version) that a mocked-DB unit test would not exercise faithfully.

## Validation

```bash
npm run build
npm run test
npm run typecheck
npm run test:integration
```

## Follow-Ups Or Risks

- `agencyId` is not populated on referrals — there is no agency reference on
  quotes or policies in the current schema to source it from without adding
  a new column; left `null` and documented here rather than fabricating data.
- Cancellation, reinstatement, and non-renewal do not evaluate UW today, so
  they were intentionally left out of the gate; if UW checks are added to
  those flows later, they should go through `resolveReferralGateForActor`
  the same way renew/rewrite/endorse do.
- `assignReferral` accepts any string for `assignedTo` without uuid
  validation; low risk (admin-permission-gated), but worth tightening if a
  dedicated "assign to underwriter" picker UI is added.
- The UW queue UI's assignment and comment endpoints are implemented
  server-side but not yet wired into the frontend — only decide
  (approve/decline) is in the UI. A follow-up could add an assignment
  picker and a comment thread to `UwQueue.tsx`.
