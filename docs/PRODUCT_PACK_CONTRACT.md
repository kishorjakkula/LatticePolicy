# Product Pack Extension Contract

This document is the single reference for adding a new insurance product pack
to LatticePolicy. It describes the required files, the framework code paths
that currently need a matching edit, and the test coverage a new product must
ship with.

Use `docs/tasks/TEMPLATE-product-pack.md` as a starting checklist when you add
a product.

## Current Product Packs (examples)

`products/personal-auto`, `products/commercial-auto`, `products/homeowners`,
`products/cyber`, `products/professional-liability`. Use these as reference
implementations — each one follows every rule in this document.

## Required Files

### 1. `products/<product-code>/coverage.yaml`

Defines selectable coverages, limits, deductibles, and `ratingKeys` (the risk
inputs the rater and the quote wizard need). See any existing product's
`coverage.yaml` for the shape. `product:` and `version:` are required
top-level fields.

### 2. `products/<product-code>/rates.yaml`

Defines base rates, rating factor tables (one map per `ratingKey`), fees, and
taxes. Loaded and merged with tenant overrides by `loadProductRates()` in
`server/src/lib/products.ts`. `product:` and `version:` are required
top-level fields.

### 3. Tenant field metadata (optional): `tenants/<tenant>/field_meta.<product-code>.json`

UI labels, validation, enum options, and display grouping for a tenant. If
absent, `loadFieldMeta()` in `server/src/lib/products.ts` falls back to a
built-in catalog for known product codes (see "Framework Code Paths" below —
this fallback is one of the places that needs a code change for a brand-new
product code unless every tenant that sells it ships its own
`field_meta.<product-code>.json`).

### 4. State eligibility data (no code change)

Rows in the `policy_eligibility` table (see `server/src/lib/policy-compliance.ts`),
keyed by `tenant_id`, `product_code` (a plain string), and `state_code`. The
eligibility check is already product-agnostic — add rows through the admin
workflow or a seed script, no code change required.

### 5. Forms (no code change)

Rows in `forms_catalog` (see `server/migrations/001_init.sql`), with
`applicability` (jsonb) used to match product/state/transaction type. The
schema is already product-agnostic — add catalog rows, no code change
required.

### 6. Sample/seed data

Add a realistic sample quote/risk payload for the product under the
project's existing seed/contract sample location (see `contracts/` for
existing sample seed data) so contributors and tests have a working example.

## Framework Code Paths That Currently Need A Matching Edit

Adding a new product code is **not** purely data-driven yet. These are the
specific places, verified against the current code, that hard-code the set of
known product codes and need a new branch/entry when a product is added:

| File | What to add |
| --- | --- |
| `server/src/lib/products.ts` | Add the new code to the `ProductCode` union; add an `else if` branch in `buildRiskFields()` for the quote-wizard field list; add a fallback branch in `loadFieldMeta()` unless every deploying tenant supplies its own `field_meta.<product-code>.json`. |
| `server/src/routes/products.routes.ts` | Add the new code to `SupportedProductCode` and the `SUPPORTED_PRODUCTS` array, or `/products/:code/config`, `/form`, and `/field-meta` will 404 it. |
| `server/src/services/rating.service.ts` | Add a branch in `rate()` dispatching to a new `rateX()` function implementing the product's rating algorithm (unless the product is fully covered by the rating workbench published-model path — see `getPublishedRatingModelForProduct`). |
| `frontend/src/features/wizard/QuoteWizard.tsx` | Add the new code to the local `ProductCode` type, the product label map, and the default-risk factory dispatch (`defaultXRisk()` functions) so the wizard renders a sensible blank form. Check for any other `productCode === '<existing-product>'` special case near your product's domain (for example, a homeowners-only step) and decide whether your product needs an equivalent branch. |

These are documented here as known extension points rather than converted to
a single registry in this change, to keep this an additive, low-risk
documentation pass. A future refactor could replace these five hard-coded
call sites with a `products/<code>/pack.ts` registry entry — track that as a
follow-up if it becomes a recurring pain point, rather than doing it
speculatively.

## Required Automated Tests For A New Product

Per `docs/TEST_PLAN.md` and `CONTRIBUTING.md`'s automation requirement, a new
product pack PR should include, at minimum:

- **Rating unit tests**: `server/src/services/__tests__/rating.service.test.ts`
  — cover the new `rateX()` function's base premium, at least one rating
  factor, fees, and taxes, following the pattern used for existing products
  in that file.
- **Quote/bind API tests**: exercise `POST` quote creation and bind for the
  new product end-to-end through the existing quote/bind test suites (see
  `server/src/__tests__/quote-to-bind.integration.test.ts`), confirming the
  product is accepted, rated, and produces a policy.
- **Product config API tests**: confirm `/products/:code/config`,
  `/products/:code/form`, and `/products/:code/field-meta` return the new
  product's data (404 before the routes change is a useful regression check).
- **Frontend wizard test**: a component test confirming the wizard renders a
  usable form for the new product code, following patterns in
  `frontend/src/features/wizard/__tests__/`.

## Adding A Product Pack: Checklist

1. Add `products/<code>/coverage.yaml` and `rates.yaml`.
2. Add the code to the four framework locations in the table above.
3. Add tenant field metadata or extend `loadFieldMeta()`'s fallback.
4. Add state eligibility rows for at least one tenant/state combination.
5. Add form catalog rows if the product requires generated documents.
6. Add rating, quote/bind, product-config, and wizard tests.
7. Add a sample quote/risk payload.
8. Update this document's "Current Product Packs" list.
9. Add a `docs/tasks/issue-<n>-<product>-pack.md` task note if the change is
   non-trivial, per `docs/AI_CONTRIBUTOR_PROCESS.md`.
