# Product retirement servicing

## Summary

Removing a product from a carrier pack's `enabledProducts` previously made
existing policies fail cancellation, endorsement, and reinstatement with
`PRODUCT_NOT_FOUND`. Sales availability now differs from installed definitions.

## Behavior and implementation

- `lib/product-registry.ts`: sales discovery and `getProductCapabilities` keep
  the enabled-products filter. Installed lookup functions read retained product
  files regardless of that filter. Issue, endorse, cancel, reinstate, and
  non-renew use installed definitions and still enforce supported transactions.
- Quote, bind, renew, and rewrite require sales availability. The quote service
  explicitly checks availability before capturing a snapshot or rating.
- Product config/form/metadata endpoints retain their permission guards and
  can read disabled installed products, so servicing screens can still load.
- Rating, validation, rules, default risks, and persisted risk-kind mapping can
  read installed definitions. This also supports legacy policies without pins.
  Pinned rating and tenant ownership checks are unchanged.
- Keep retired product files installed. Physically deleting definitions is
  outside this fix; servicing requires their metadata.

## Regression coverage

- `product-registry.test.ts`: disabled homeowners stays out of sales discovery;
  servicing capabilities and legacy rating work; sales transactions are denied.
  This test failed with `PRODUCT_NOT_FOUND` before the fix.
- `carrier-pack-lifecycle.integration.test.ts`: issue policies before disabling
  a pack product, then preview/execute endorsements, cancel, and reinstate both
  pinned and legacy policies. New quotes and renewal previews are denied.
  Fixtures use a disposable copy of the example pack.

## Validation

- `npm run test:server`: 528 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- PostgreSQL integration with `TENANT_RLS_ENFORCED=1`: carrier pack lifecycle,
  product version pinning, and snapshot isolation: 10 tests passed.

## Scope

The two P2 pinned-form findings from the review remain separate follow-ups.
