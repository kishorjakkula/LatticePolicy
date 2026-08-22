# Task Note: Product Pack Example

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/176
- Pull request:

## Summary

Added `products/example-identity-protection/` as a minimal, worked
`coverage.yaml`/`rates.yaml` example — one selectable coverage, one rating
factor, a flat fee, and a flat tax rate — so a new contributor can see the
smallest valid product-pack shape without reading a full production example
like `products/personal-auto`. This is explicitly a documentation/template
example, not a live, quotable product.

## Important Files

- `products/example-identity-protection/coverage.yaml`: one coverage
  (`MONITOR`) with three selectable limits and one rating key.
- `products/example-identity-protection/rates.yaml`: base rate, the
  `monitoringLimitFactors` table (one entry per coverage limit), a flat
  policy fee, and a flat tax rate.
- `products/example-identity-protection/README.md`: explains what the
  example demonstrates and explicitly what it does *not* do (it is not wired
  into `server/src/lib/products.ts`'s `ProductCode` union,
  `server/src/routes/products.routes.ts`, `server/src/services/rating.service.ts`,
  or `frontend/src/features/wizard/QuoteWizard.tsx` — see
  `docs/PRODUCT_PACK_CONTRACT.md` for what that wiring involves).
- `server/src/services/__tests__/example-product-pack.test.ts`: fixture
  validation — both YAML files parse, share the required `product`/`version`
  fields, every declared coverage limit has a matching rating factor, and
  base/fees/taxes are present with sane values.

## Behavior Rules

- This example is intentionally **not** added to `docs/PRODUCT_PACK_CONTRACT.md`'s
  "Current Product Packs" list, since that list is reserved for real,
  fully-wired reference implementations per that document's own wording.
- No framework code path (`ProductCode` union, rating dispatcher, product
  routes, or quote wizard) was touched — this keeps the change additive and
  low-risk, matching `docs/PRODUCT_PACK_CONTRACT.md`'s stated goal for
  documentation passes.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/example-product-pack.test.ts` (new, 4
    cases)
- Test layer used: unit test reading and parsing the real YAML files with
  the same `yaml` package the production loader
  (`loadProductRates` in `server/src/lib/products.ts`) uses.
- Why this layer is enough: this is static fixture data with no service or
  API behavior to exercise; a fixture-validation unit test is the smallest
  layer that proves the example is internally consistent and loadable.

## Validation

```bash
npm run test --workspace=server
npm run typecheck
npm run build
```

## Follow-Ups Or Risks

- If a maintainer wants this example to become a real, quotable product,
  follow `docs/tasks/TEMPLATE-product-pack.md`'s checklist to wire it into
  the four framework code paths listed above, then move it out of the
  `example-` naming and add it to `docs/PRODUCT_PACK_CONTRACT.md`'s current
  product list.
