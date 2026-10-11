# Example Carrier Pack

A carrier pack is the versioned set of config files a carrier's developers
keep in their own repository. A carrier stack loads it from the directory
named by `CARRIER_PACK_DIR`, so the carrier's customisations sit outside the
core image and are not touched by a release upgrade.

This example is for a carrier `acme-mutual`. Copy it as a starting point.

## Layout

| Path | Purpose |
| --- | --- |
| `pack.yaml` | Manifest: `packFormat`, `carrier` (the tenant id), `version`. |
| `config.yaml` | `enabledProducts` and `overrides` for rating, underwriting, and documents. Optional. |
| `products/<code>/coverage.yaml` | A product the carrier adds: coverages, limits, deductibles, capabilities. Same contract as `docs/PRODUCT_PACK_CONTRACT.md`. |
| `products/<code>/rates.yaml` | That product's rate and factor tables. |
| `fields/<code>.json` | Field metadata for a product (core or added): type, validation, visibility, grouping, order. Optional. |

## What this example shows

- **A new product**, `condo-unit-owners`, with its own coverages and limits,
  including a `LOSS_ASSESS` coverage the framework's homeowners product does
  not have.
- **New fields** on that product: `floorLevel`, `masterPolicyDeductible`, and
  `associationName`.
- **Its own rate tables**, applied by the framework's homeowners rating steps
  (`ratingAdapter: homeowners`).
- **Which products the carrier sells** (`enabledProducts`): two core products
  plus the new one. Core products not listed are not offered.
- **A tuned core product**: different personal-auto driver age factors.

## Rules

- `carrier` must equal the stack's `CARRIER_TENANT_ID`.
- A pack adds products under new codes. It cannot replace a core product.
- `ratingAdapter` must be one the release provides, or `unsupported` for a
  product that is not quotable yet.
- Every product in `enabledProducts` and every `fields/<code>.json` must name
  a core product or one in the pack.

## Checking a pack

```bash
# From a checkout
npm run validate:pack --workspace=server -- ../examples/carrier-pack

# With a release image, for example before taking that release
docker run --rm -v "$PWD/my-pack:/carrier-pack:ro" <api-image>:<version> \
  node server/dist/validateCarrierPack.js /carrier-pack
```

The command exits non-zero and lists each problem with the file it is in. A
stack started with `CARRIER_PACK_DIR` runs the same check and refuses to
start on an invalid pack.

## Not in the pack format yet

Custom tables, screen layouts, coverage triggers, rating workbooks, form
templates, and layering a carrier product over a core product are planned
additions to the format.
