# Sample Carrier Tenant

`sample-carrier` is the reference demo tenant used by local development,
Docker Compose, and the default frontend tenant selector (`X-Tenant` defaults
to `sample-carrier`; see `docs/PROJECT_CONTEXT.md`). Demo users (`admin`,
`uw1`, `agent1`, and a `customer1` portal fallback) all operate under this
tenant. Use it as the reference example when adding a new tenant.

## What it demonstrates

- **Product enablement** (`config.yaml` → `enabledProducts`): this tenant has
  `personal-auto` and `homeowners` turned on. A product listed under
  `products/` is only available to a tenant once it appears here.
- **Rating overrides** (`config.yaml` → `overrides.rating`): a
  `driverAgeFactors` table that adjusts the base personal-auto rating
  factors per age band, showing how a carrier can tune rates without
  touching shared rating code in `products/`.
- **Underwriting overrides** (`config.yaml` → `overrides.underwriting.rules`):
  a declarative referral rule (`HO-ROOF-AGE`) that refers homeowners risks
  with a roof older than 25 years, showing the low-code referral-rule
  pattern described in `overrides/README.md` and `docs/ARCHITECTURE.md`.
- **Document template pack** (`config.yaml` → `overrides.documents`): points
  at the `default` template pack; change this key to point a tenant at a
  carrier-specific pack once one exists.
- **Field metadata** (`field_meta.<productCode>.json`, e.g.
  `field_meta.homeowners.json`): tenant-specific field visibility, editability
  (by role), validation, and UI grouping/ordering for a product's risk
  fields. Loaded per tenant + product code by `loadFieldMeta` in
  `server/src/lib/products.ts`. Add one `field_meta.<productCode>.json` file
  per enabled product that needs field-level customization; a product with
  no file for a tenant falls back to its framework defaults.
- **`overrides/`**: reserved for declarative or low-code extension files
  (rating/underwriting/documents); see `overrides/README.md` for the current
  scope and rules for what belongs there versus core/product pack files.

## Adding a new tenant

Copy this folder's structure as a starting point: a `config.yaml` with
`tenantId`, `enabledProducts`, and any `overrides`, plus one
`field_meta.<productCode>.json` per product that needs field-level
customization for that tenant. See `docs/ARCHITECTURE.md`'s tenant plugin
section and `docs/PROJECT_CONTEXT.md` for how tenant config is resolved and
merged at runtime.
