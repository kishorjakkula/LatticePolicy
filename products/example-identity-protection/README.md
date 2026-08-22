# Example Product Pack: `example-identity-protection`

This folder is a **worked example**, not a real, framework-wired product. It
exists so a new contributor can see the smallest possible valid
`coverage.yaml` / `rates.yaml` pair and understand the product-pack file
contract without wading through a full production example like
`products/personal-auto`.

It demonstrates one selectable coverage (`MONITOR`, an identity-monitoring
limit) with a single rating factor (`monitoringLimitFactors`), a flat policy
fee, and a flat tax rate — the minimum shape the loader in
`server/src/lib/products.ts` expects.

## What this example does NOT do

Adding this folder alone does **not** make `example-identity-protection` a
quotable product. Per `docs/PRODUCT_PACK_CONTRACT.md`, a product only becomes
live once its code is added to the framework's extension points:

- `server/src/lib/products.ts`: `ProductCode` union, `buildRiskFields()`,
  `loadFieldMeta()` fallback
- `server/src/routes/products.routes.ts`: `SupportedProductCode`,
  `SUPPORTED_PRODUCTS`
- `server/src/services/rating.service.ts`: a `rate()` branch and `rateX()`
  implementation
- `frontend/src/features/wizard/QuoteWizard.tsx`: `ProductCode` type, label
  map, default-risk factory

This example intentionally stops short of that wiring so it stays a small,
low-risk documentation aid. Use
`docs/tasks/TEMPLATE-product-pack.md` as your checklist when you're ready to
turn a real product idea into a fully wired pack, and see
`server/src/services/__tests__/example-product-pack.test.ts` for a test that
validates this example's YAML shape and internal consistency (every coverage
limit has a matching rating factor) the same way you'd validate a real one
before wiring it in.

## Files

- `coverage.yaml`: the one selectable coverage and its rating key.
- `rates.yaml`: base rate, the rating factor table for that key, a flat fee,
  and a flat tax rate.
