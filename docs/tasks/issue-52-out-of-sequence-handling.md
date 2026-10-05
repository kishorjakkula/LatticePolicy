# Task Note: Out-Of-Sequence Handling Beyond Endorsements

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/52
- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/162

## Summary

Extended the effective-dated timeline/rebase model — previously exercised
only by endorsements — to cancellation and reinstatement. Both transaction
types now detect when their effective date lands before an already-processed
later transaction, record `outOfSequence`/`rebasedTransactions`/
`retroAdjustment` metadata the same way endorsement does, and refresh the
persisted `policy_timeline_segments` cache so `GET /policies/:id/state?asOf=`
stays correct afterward.

While building this, found and fixed a real pre-existing bug in
`endorsement.service.ts`: `previewEndorsement`/`executeEndorsement` read
`policyRow.term_effective_date`/`term_expiration_date`/`currency_code`/
`product_code` (snake_case), but `loadPolicyContext` returns Drizzle-shaped
camelCase fields. Those reads were always `undefined`, so `coerceDateOnly`
silently fell back to **today's date** for every endorsement's term window —
corrupting segment/premium/rebase computation for all endorsements, not just
out-of-sequence ones. This was invisible before because no existing test
asserted on `policy_timeline_segments` row content. Fixed by reusing the
same dual-key-safe field access pattern `lifecycle.service.ts` already used.

## Important Files

- `server/src/services/endorsement.service.ts`:
  - Exported `loadPolicyTimelineVersions`, `loadCurrentTimelineVersion`,
    `nextPolicyTransactionSequence`, `persistPolicyTimelineSegments` so
    `lifecycle.service.ts` can reuse the same generic timeline machinery
    instead of duplicating it.
  - Added a local `policyField(row, camelKey, snakeKey)` helper and fixed
    every `policyRow.snake_case` read in `previewEndorsement` and
    `executeEndorsement` (term dates, currency, product code) to use it.
  - Added `outOfSequence: computation.rebasedTransactions.length > 0` to the
    persisted endorsement transaction metadata, so the existing audit UI
    banner in `TransactionAuditPanel.tsx` (issue #53) — which checks
    `metadata.outOfSequence`/`isOutOfSequence`/`rebased` — actually lights up
    for endorsements. Before this change no code path in the repo ever set
    any of those three keys.
- `server/src/services/lifecycle.service.ts`:
  - Added `computeOutOfSequenceContext` (detects rebase, computes the
    premium basis that was actually in effect on the transaction's effective
    date), `nextTimelineVersion`, and `computeNewSegmentsAndRetro` (pure —
    does not write to the DB).
  - `cancelPolicy` and `reinstatePolicy` now call these helpers: they use
    the historically-correct premium basis for refund/reinstatement-charge
    math only when the transaction is genuinely out-of-sequence (in-sequence
    behavior is unchanged), record rebase/retro metadata on the transaction,
    and persist refreshed timeline segments **after** `insertPolicyVersion`
    (segment rows carry a foreign key to `policy_versions.version_id`, so
    persisting before that insert fails with a constraint violation — this
    was caught by the new integration test and by the existing lifecycle
    test regressing during development).
- `server/src/__tests__/policy-lifecycle.integration.test.ts`: new DB
  integration test — endorse, then backdated out-of-sequence cancel, then
  assert rebase metadata and a corrected `getPolicyState(asOf)` result.

## Behavior Rules

- Cancellation/reinstatement effective dates before an already-processed
  later transaction are detected via `findRebasedTransactions` (existing,
  transaction-type-agnostic helper) and recorded as `outOfSequence: true` /
  `rebasedTransactions: [...]` / `retroAdjustment: {...}` on the transaction,
  exactly like endorsement.
- The refund (cancel) / reinstatement charge (reinstate) basis switches from
  the policy's current top-level premium to the historically-correct segment
  premium at the effective date **only** when out-of-sequence; in-sequence
  cancellation/reinstatement behavior is byte-for-byte unchanged.
- Every cancel/reinstate now bumps `timeline_version` and re-persists
  `policy_timeline_segments`, whether or not it is out-of-sequence — this is
  required so `getPolicyState`'s persisted-cache path (used once any
  endorsement has ever run) does not go stale after a cancel/reinstate.
- Renewal and rewrite are **not** given out-of-sequence support. Both start
  a brand-new term window (`renewPolicy`/`rewritePolicy` compute a new
  `termEffectiveDate`/`termExpirationDate` rather than fitting inside the
  current term), so the mid-term segment/rebase model does not apply the
  same way. This is the "documented as constrained" outcome the issue's
  acceptance criteria explicitly allows.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/policy-lifecycle.integration.test.ts` — new test
    `records rebase metadata and keeps as-of state correct for an
    out-of-sequence cancellation`.
- Test layer used: DB-backed integration test (real Postgres via
  `scripts/test-integration.sh`).
- Why this layer is enough: this is multi-table persistence (transactions,
  versions, timeline segments) plus a derived read (`getPolicyState`), which
  needs a real database to verify correctly; a mocked unit test would not
  have caught either the foreign-key ordering bug or the term-date bug this
  change fixed.

## Validation

```bash
npm run build
npm run test          # 74 frontend + 136 server, all passing
npm run typecheck
npm run test:integration   # 30/30 passing, via disposable Postgres 15 container
```

## Follow-Ups Or Risks

- Renewal/rewrite out-of-sequence support is explicitly out of scope here
  (see Behavior Rules); if a future business rule needs mid-term rebasing
  across a renewal boundary, it needs its own design pass.
- `GET /policies/:id/state?asOf=` was verified for the cancel case in the
  new integration test; reinstate uses the identical code path
  (`computeOutOfSequenceContext` / `computeNewSegmentsAndRetro` /
  `persistPolicyTimelineSegments`) but does not have a dedicated OOS test
  yet — low risk given the shared implementation, but worth adding if this
  area sees further changes.
- The `endorsement.service.ts` term-date bug fix is a behavior change for
  **every** endorsement (not just out-of-sequence ones): term windows used
  for segment/premium computation are now correct instead of silently
  defaulting to "today". No existing test asserted on the previously-wrong
  behavior, and the full suite (unit + integration) passes with the fix, but
  this is worth calling out explicitly in review since it touches a
  previously-silent defect in a core, frequently-used code path.
