# Task Note: Carrier Pack Rules On Every Transaction

## Links

- Issue: none yet (follow-up to phase 3, step 3)
- Pull request:

## Summary

A carrier pack's product rules (required fields, conditional requirements,
validations) were enforced only when a quote was created or rated. They now
apply to every transaction that creates or changes risk data, and a full
lifecycle test proves a pack product's rating, fields, and rules hold from
quote to renewal.

## Important Files

- `server/src/services/product-rules.service.ts`: `productRuleViolations`,
  `assertProductRules`, `sameRiskData`.
- `server/src/services/quote.service.ts`: quote (code `INVALID_QUOTE`).
- `server/src/services/quote-bind.service.ts`: bind.
- `server/src/services/endorsement.service.ts`: `computeEndorsementTimeline`,
  so both preview and execution are checked.
- `server/src/services/lifecycle.service.ts`: renewal, rewrite, and
  cancellation or reinstatement that changes the risk data.
- `server/src/routes/transactions.routes.ts`: the same checks on the
  in-memory renewal and rewrite paths.
- `server/src/__tests__/carrier-pack-lifecycle.integration.test.ts`.

## Behavior Rules

- Any transaction that stores new or changed risk data must call
  `assertProductRules` before rating. A new transaction type that takes a
  payload needs the same call.
- A plain cancellation or reinstatement (risk data unchanged) is never
  blocked by product rules. If the payload sent with it changes risks or
  coverages, the rules apply; otherwise either could be used to store data
  the rules reject.
- A rule failure outside a quote is `422 PRODUCT_RULES_NOT_MET` with
  `details.transaction` and `details.errors` (`keyword: 'screen'`, a path
  under `/risks/0`).
- With no carrier pack, or for a product the pack defines no rules for, the
  checks return immediately and behavior is unchanged.
- Renewal applies the product's current rules, matching the decision that
  product changes apply to new business and renewals.

## Automated Tests

- `carrier-pack-lifecycle.integration.test.ts` takes the example pack product
  through quote, bind, issue, endorsement preview and execution, cancellation,
  reinstatement, renewal preview, renewal, and rewrite, checking the
  `rate-table` premium, the pack's custom fields on the stored policy, and
  rejection of rule-breaking data at each transaction.
- The full integration and unit suites pass with no pack configured.
- Exercised by hand in a browser: the endorsement wizard for an issued pack
  policy showed the pack's tabs and stored values, blocked a rule-breaking
  change with the pack's message, and continued once it was fixed.

## Validation

```bash
npm run test:server
npm run test:integration
```

## Follow-Ups Or Risks

- A policy written before a rule was added can fail that rule at its next
  endorsement or renewal. That is intended, but there is no report of
  in-force policies that would fail a new pack version before it is loaded.
- Per-term product version pinning was added afterwards; see
  `docs/tasks/product-version-pinning.md`.
- The cancellation, reinstatement, renewal, and rewrite wizards were not
  driven in a browser for a pack product; only endorsement was.
- Non-renewal and issue take no risk data and are not checked.
