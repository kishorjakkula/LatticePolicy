# Product Pack Extension Contract

This is the reference for adding an insurance product pack to LatticePolicy.
Product packs are discovered from disk; adding a pack does not require editing
a framework allowlist.

Use `docs/tasks/TEMPLATE-product-pack.md` as the implementation checklist.

## Required Files

### `products/<product-code>/coverage.yaml`

Defines coverages, limits, deductibles, `ratingKeys`, and the product's
capability descriptor. `product`, `version`, and `capabilities` are required.

The `capabilities` object contains:

- `label` and `riskLabel` for user-facing metadata;
- `ratingAdapter`, naming an executable adapter or `unsupported`;
- `formsMode`, either `catalog` or `none`;
- `supportedTransactions`, using canonical lifecycle action names;
- `riskKinds`, mapping payload risk types to persisted risk-unit kinds;
- `defaultRisk`, used by frontend and generic field generation;
- `ui`, reserved for product presentation metadata.

### `products/<product-code>/rates.yaml`

Defines base rates, factor tables, fees, and taxes. `product` and `version` are
required. Tenant overrides are merged by `loadProductRates()`.

### Tenant Field Metadata (Optional)

`tenants/<tenant>/field_meta.<product-code>.json` supplies labels, validation,
enum options, and grouping. When absent, established packs use their built-in
catalog and new packs receive generic fields derived from `ratingKeys` and
`capabilities.defaultRisk`.

### Eligibility, Forms, And Samples

- Add state eligibility through `policy_eligibility`; no framework edit is needed.
- Add document forms through the forms catalog; no framework edit is needed.
- Add realistic sample quote and risk payloads under `contracts/`.

## Registry Contract

`GET /v1/products` returns the shared registry contract. The server uses it
for product routing, rating dispatch, transaction checks, and risk mapping.
The frontend uses it for selectors, labels, risk labels, and defaults.

Unknown products return `PRODUCT_NOT_FOUND`. A known product that lacks a
requested transaction or executable rater returns a specific capability error
instead of falling through to another product's implementation.

## Required Tests

- Rating tests cover the configured adapter, factors, fees, and taxes.
- Quote and bind tests prove supported lifecycle capabilities end to end.
- Product API tests cover discovery, config, generated form, and field metadata.
- Frontend tests prove registry labels and defaults render in quote workflows.
- Unsupported capabilities have explicit negative tests.

## Adding A Product Pack

1. Add `coverage.yaml` and `rates.yaml` under `products/<code>/`.
2. Add complete `capabilities` metadata to `coverage.yaml`.
3. Add tenant field metadata when the generated fallback is insufficient.
4. Add eligibility rows for at least one tenant and jurisdiction.
5. Add catalog forms when the product requires generated documents.
6. Add rating, quote/bind, product API, and frontend tests.
7. Add a sample quote/risk payload.
8. Confirm the pack appears in `GET /v1/products` without framework edits.
9. Add an AI-readable task note under `docs/tasks/` for non-trivial work.
