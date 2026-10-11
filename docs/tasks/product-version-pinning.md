# Task Note: Product Version Pinning Per Policy Term

## Links

- Issue: none yet (phase 3, version pinning from step 6)
- Pull request:

## Summary

Product changes apply to new business and renewals. Until now a mid-term
endorsement was re-rated with whatever the product definition was that day,
so loading a new carrier pack, publishing a rating workbook, or taking a
release could change the premium of a policy already in force. Each policy
term is now pinned to a snapshot of the product it was written on.

## Important Files

- `server/migrations/059_product_snapshots.sql`: `product_snapshots`, one
  immutable row per distinct definition, tenant-scoped with RLS.
- `server/src/lib/product-snapshot.ts`: capture, load, pin, and carry.
- `server/src/services/rating.service.ts`: `rate()` prices a pinned payload
  from its snapshot (rates, config, adapter, published workbook).
- `server/src/services/product-rules.service.ts`: rules come from the pinned
  screen.
- `server/src/services/quote.service.ts`, `lifecycle.service.ts`
  (renew, rewrite, renewal preview): pin to the current product.
- `server/src/services/endorsement.service.ts`, `lifecycle.service.ts`
  (cancel, reinstate): carry the term's pin.
- `server/src/persistence.ts` (`loadPolicyContext`),
  `endorsement.service.ts` (`loadPolicyTimelineVersions`),
  `quote-bind.service.ts`, `routes/ai.routes.ts`: load the snapshots stored
  payloads name before anything rates them.
- `server/src/routes/products.routes.ts`: `GET /products/:code/form?policyId=`
  serves the pinned screen. The wizard passes it for mid-term transactions.

## Behavior Rules

- A term's pin is set by the server when the term starts (quote rating,
  renewal, rewrite) and carried from the stored policy on every mid-term
  transaction. A pin sent by a client is always overwritten.
- `rate()` must never price a pinned payload with today's definition. If the
  snapshot is not loaded it throws `PRODUCT_VERSION_NOT_LOADED`.
- `rate()` is synchronous, so anything that rates a stored payload must call
  `ensureProductSnapshots` first. The two shared loaders above already do.
- Snapshots are immutable and content-addressed. Never update a row; a
  changed definition is a new row.
- A payload with no pin (a policy written before this change) is rated on the
  current definition, as before.
- A snapshot covers data: rates with overrides applied, product config,
  screen rules, the adapter name, and the published workbook. It does not
  freeze rating code; the built-in adapters' formulas change with a release.

## Automated Tests

- `server/src/__tests__/product-version-pinning.integration.test.ts`: writes a
  policy, changes the pack (higher rate, new rule), then checks that new
  business uses the change, a mid-term endorsement is priced exactly on the
  original tables and is not subject to the new rule, a client-supplied pin
  is ignored, the renewal moves to the new version and must meet the new
  rule, the form endpoint serves the pinned screen, and a missing snapshot is
  refused rather than rated at today's rates.
- Full integration suite with and without `TENANT_RLS_ENFORCED`, and the unit
  and frontend suites.

## Validation

```bash
npm run test:server
npm run test:frontend
npm run test:integration
```

## Follow-Ups Or Risks

- Policies written before this change have no pin and keep following the
  current definition until their next renewal or rewrite.
- A quote is pinned when it is rated. A quote rated before a pack change and
  bound after it becomes a policy on the earlier version.
- The pinned screen in the wizard was tested through the endpoint, not in a
  browser.
- `product_snapshots` rows are never removed. They are small in number (one
  per distinct definition per product) but a published workbook can make a
  row large.
- Snapshots are cached per process without eviction.
- Coverage options the wizard offers for a mid-term transaction still come
  from the current product config, not the pinned one.
- Out-of-sequence timeline recalculation swallows rating errors and records a
  zero premium; with a missing snapshot that path would understate a segment
  before the explicit check stops the transaction.
