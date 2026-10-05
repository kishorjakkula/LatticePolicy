# Task Note: Product Pack Extension Contract

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/56
- Pull request:

## Summary

Added a documented contract and checklist for adding a new insurance product
pack, based on tracing the real code paths that currently key off a
hard-coded product code list.

## Important Files

- `docs/PRODUCT_PACK_CONTRACT.md`: required files, framework code paths that
  need a matching edit for a new product code, required test layers, and an
  add-a-product checklist.
- `docs/tasks/TEMPLATE-product-pack.md`: copyable checklist for a new product
  pack PR.
- `docs/PROJECT_CONTEXT.md`: links the new contract doc from "Product And
  Rating Extension Points" and "Key Docs".
- `README.md`: links the new contract doc from "Documentation" and
  "Extension Points".

## Behavior Rules

- No runtime behavior changed; this is a documentation-only change.
- The contract documents, rather than removes, five hard-coded product-code
  call sites (`server/src/lib/products.ts`'s `ProductCode` union,
  `buildRiskFields()`, and `loadFieldMeta()` fallback;
  `server/src/routes/products.routes.ts`'s `SUPPORTED_PRODUCTS`;
  `server/src/services/rating.service.ts`'s `rate()` dispatcher; and
  `frontend/src/features/wizard/QuoteWizard.tsx`'s product type/label
  map/default-risk dispatch). Converting these to a single registry is called
  out as an optional future follow-up, not done here, to keep this change
  additive and low-risk.
- State eligibility (`policy_eligibility`) and forms (`forms_catalog`) are
  already product-agnostic (product code stored as plain data), so adding a
  product needs new rows there, not new code.

## Automated Tests

- Tests added or updated: none.
- Test layer used: documentation review.
- Why this layer is enough: no application code or runtime behavior changed.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

## Follow-Ups Or Risks

- Consider replacing the five hard-coded product-code call sites with a
  single `products/<code>/pack.ts` registry if the framework starts adding
  product packs frequently enough that the duplication becomes a real
  maintenance cost.
- No automated "product pack completeness" validation script was added; the
  issue marks this optional and the documentation-only checklist satisfies
  the acceptance criteria.
