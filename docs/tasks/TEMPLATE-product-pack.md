# New Product Pack Checklist: <product-code>

Copy this file to `docs/tasks/issue-<n>-<product-code>-pack.md` and fill it in
while you add the product. See `docs/PRODUCT_PACK_CONTRACT.md` for the full
contract this checklist is based on.

## Product Files

- [ ] `products/<product-code>/coverage.yaml`
- [ ] `products/<product-code>/rates.yaml`
- [ ] Sample seed/quote payload added

## Framework Code Paths Updated

- [ ] `server/src/lib/products.ts`: `ProductCode` union, `buildRiskFields()`,
      `loadFieldMeta()` fallback (or tenant `field_meta.<product-code>.json`)
- [ ] `server/src/routes/products.routes.ts`: `SupportedProductCode`,
      `SUPPORTED_PRODUCTS`
- [ ] `server/src/services/rating.service.ts`: `rate()` branch + `rateX()`
- [ ] `frontend/src/features/wizard/QuoteWizard.tsx`: `ProductCode` type,
      label map, default-risk factory

## Data

- [ ] State eligibility rows added for at least one tenant/state
- [ ] Form catalog rows added if the product generates documents

## Tests

- [ ] Rating unit tests in `server/src/services/__tests__/rating.service.test.ts`
- [ ] Quote/bind integration coverage
- [ ] Product config API coverage (`/config`, `/form`, `/field-meta`)
- [ ] Frontend wizard component test

## Docs

- [ ] `docs/PRODUCT_PACK_CONTRACT.md` "Current Product Packs" list updated
- [ ] This task note completed with links, summary, and validation commands run
