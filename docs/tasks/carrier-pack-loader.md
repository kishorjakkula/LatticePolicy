# Task Note: Carrier Pack Format, Validator, And Loader

## Links

- Issue: none yet (phase 3, step 1 of the carrier isolation and admin roles proposal)
- Pull request:

## Summary

Carriers customise by adding products, fields, and overrides. Until now those
files lived inside this repository and the API image. A carrier pack moves
them to a versioned directory the carrier owns, loaded from `CARRIER_PACK_DIR`,
validated at startup and before an upgrade.

## Important Files

- `server/src/lib/carrier-pack.ts`: pack location, manifest, and paths.
- `server/src/lib/carrier-pack-validator.ts`: `validateCarrierPack`,
  `assertCarrierPackValid` (startup gate).
- `server/src/validateCarrierPack.ts`: the validation command.
- `server/src/lib/product-registry.ts`: products are discovered from core plus
  the pack; `enabledProducts` filters the list when a pack sets it.
- `server/src/lib/products.ts`: rates, product config, overrides, and field
  metadata resolve through the pack for the pack's carrier.
- `server/src/contracts.ts`: the quote contract accepts a product the registry
  knows even though the JSON schema enumerates only core products.
- `server/src/index.ts`: startup gate. `server/src/app.ts`: pack version in
  `GET /version`.
- `deploy/carrier-stack/`: `CARRIER_PACK_PATH`, read-only mount,
  `stack.sh pack-check`, and the pack check inside `up` and `upgrade`.
- `examples/carrier-pack/`: worked example with a new product and new fields.

## Behavior Rules

- No pack configured means no change: every loader falls back to the
  repository paths it used before.
- A pack applies only to the carrier in its manifest. Another tenant on the
  same process never reads it.
- A pack adds products under new codes; it cannot replace a core product.
  Layering a carrier product over a core product is a later step.
- An invalid pack stops startup in every environment. Do not downgrade pack
  errors to warnings to get a stack running.
- `CARRIER_PACK_FORMAT` changes only when the layout changes incompatibly;
  additive keys do not bump it.
- `upgrade` checks the pack against the target release before it backs up,
  stops, or migrates anything.

## Automated Tests

- `server/src/lib/__tests__/carrier-pack.test.ts`: validation errors and
  warnings, startup gate, product discovery, `enabledProducts`, loaders,
  carrier scoping, rating a pack product with its own tables, legacy behavior
  with no pack, and the quote contract.
- Test layer used: server unit tests. The full unit and integration suites
  were run to confirm nothing changed with no pack configured.
- Exercised by hand on a kit stack built from local images (pinned carrier,
  row-level security on, pack mounted): product list, field metadata, a rated
  quote for the pack product with its custom fields stored, an upgrade the
  pack fits, an upgrade it does not fit (stopped before any change), and a
  broken pack at restart (refused).

## Validation

```bash
npm run typecheck --workspace=server
npm run test --workspace=server
npm run test:integration
npm run validate:pack --workspace=server -- ../examples/carrier-pack
```

## Follow-Ups Or Risks

- The frontend was not changed or tested with a pack product. The quote
  wizard and create-quote page still branch on the five core product codes
  (step 2).
- A pack product must reuse an existing rating adapter and an existing risk
  type. The homeowners adapter has its base rate and coverage weights in
  code, so a pack's `rates.yaml` only controls the factor tables it reads.
  A generic workbook-driven rating path is step 2.
- `contracts/quote.request.schema.json` still enumerates core products and
  risk types; the server relaxes only the product code check.
- `enabledProducts` hides a product from the registry on that stack, so an
  existing policy for a product later removed from the list would stop
  resolving. Treat removal as a product retirement, not a toggle.
- The registry re-reads pack files on each call, as it already did for core
  product files. Cache if it shows up in profiles.
- State eligibility for a pack product is still configured in the database
  through the compliance admin, not in the pack.
