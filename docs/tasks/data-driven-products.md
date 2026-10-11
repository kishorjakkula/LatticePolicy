# Task Note: Data-Driven Products (Table Rating And Pack-Defined Quote Form)

## Links

- Issue: none yet (phase 3, step 2 of the carrier isolation and admin roles proposal)
- Pull request:

## Summary

A product added by a carrier pack could be listed and stored but not really
sold: rating needed one of five code adapters, the quote form showed only
generic text boxes, and the review step printed another product's fields.
This change lets a pack product be rated, quoted, and bound with no
product-specific code, while the five core products keep their existing code
paths untouched.

## Important Files

- `server/src/lib/rating-table.ts`: `rateFromRateTable` (the `rate-table`
  adapter) and `validateRateTable`.
- `server/src/services/rating.service.ts`: dispatches `rate-table`; a
  published rating workbook still takes precedence, as for core products.
- `server/src/lib/products.ts`: `buildRiskFields` builds a pack product's form
  from `fields/<code>.json` (labels, options, help, sections, order).
- `server/src/lib/carrier-pack-validator.ts`: validates `rate-table` rating,
  `limitType`, and `defaultLimit`.
- `server/src/lib/uw-companies-store.ts`: an underwriting company can write a
  registry product, not only the five core codes.
- `frontend/src/features/wizard/QuoteWizard.tsx`: sectioned
  `DynamicRiskForm`, a field-driven risk summary for non-core products, and a
  free-form limit input in the generic coverage editor.
- `examples/carrier-pack/`: the example product now uses `rate-table`.

## Behavior Rules

- Core products are unchanged. Every new path is reached only by a product
  that is not one of the five core codes, or by `ratingAdapter: rate-table`.
  Keep it that way until a core product is deliberately migrated.
- `rate-table` never guesses: an unpriced coverage, an unrated limit, or a
  missing required factor rejects the quote with a specific code.
- Every `rate-table` result carries a `calcTrace` with each factor and
  pricing method used.
- A factor with no match uses its `default`, or 1; that is recorded in the
  trace as `matched: false`.
- The pack validator must reject a `rate-table` product whose coverages or
  offered limits cannot all be priced.

## Automated Tests

- `server/src/lib/__tests__/rating-table.test.ts`: hand-computed premiums,
  trace, term factor, minimum premium, each pricing method, rejections, band
  parsing, and validation.
- `server/src/lib/__tests__/carrier-pack.test.ts`: rating and form building
  for the example product through the registry, and core forms unchanged.
- `frontend/src/features/wizard/__tests__/DynamicRiskForm.test.tsx`.
- Full server unit, integration, and frontend suites run with no pack.
- Exercised by hand in a browser against a kit stack with the example pack:
  login, product selection, the pack's sectioned risk form, default
  coverages, rating (figures matched a hand calculation), review, and bind to
  a policy. Not an automated end-to-end test.

## Validation

```bash
npm run typecheck
npm run test:server
npm run test:frontend
npm run test:integration
```

## Follow-Ups Or Risks

- No automated end-to-end test covers a pack product; the e2e suite runs
  against a stack with no pack.
- `rate-table` rates the first risk only, like the existing adapters. Per-item
  rating for lists of risks needs the custom tables step.
- A pack product must still use a risk type the quote contract defines.
- Remaining core-only behavior for pack products: no qualification
  questions, no built-in underwriting rules (the admin rules engine applies),
  no AI insight tuning, no exposure breakdown beyond total insured value, and
  no customer-portal ID card.
- `overrides.underwriting.rules` in a tenant or pack config is only honored
  for the built-in `HO-ROOF-AGE` rule; its `when` expressions are not
  evaluated. Carrier rules belong in the admin underwriting rules engine
  until the expression engine exists.
- The generic coverage editor sends drop-down limits and deductibles as
  strings; `rate-table` accepts both strings and numbers.
- The five core products still have product branches in the wizard, rating,
  and underwriting. Migrating a core product to `rate-table` needs a proof
  that its premiums are unchanged.
