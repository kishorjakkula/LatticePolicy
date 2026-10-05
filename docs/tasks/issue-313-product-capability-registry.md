# Issue 313: Product Capability Registry

## Links

- Epic: https://github.com/kishorjakkula/LatticePolicy/issues/310
- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/313

## Summary

Product packs now declare a shared capability descriptor in `coverage.yaml`.
The server discovers product directories automatically and exposes descriptors
through `GET /v1/products`. Server workflows and frontend selectors consume
that contract instead of maintaining separate product allowlists.

## Important Files

- `packages/types/src/index.ts`: shared capability contract
- `server/src/lib/product-registry.ts`: discovery, validation, and checks
- `server/src/routes/products.routes.ts`: dynamic product APIs
- `server/src/services/rating.service.ts`: registry-based rating dispatch
- `frontend/src/features/wizard/QuoteWizard.tsx`: registry labels and defaults
- `products/*/coverage.yaml`: product capability declarations

## Behavior Rules

- A product directory is registered only when its `coverage.yaml` is valid.
- Directory and declared product codes must match.
- Transactions are rejected when the pack does not declare the capability.
- Rating dispatch uses `ratingAdapter`, not the product code itself.
- Risk-unit kinds and default UI risk objects come from pack metadata.

## Automated Tests

Registry tests prove all existing packs and the example pack are discovered,
risk mapping is data-driven, and unsupported bind/rating operations fail
clearly without adding the example product to framework source code.

## Validation

```bash
npm run test:local
npm run test:integration
npm run typecheck
npm run build
```
