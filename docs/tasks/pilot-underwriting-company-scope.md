# Pilot underwriting company scope

## Request and cause

The Homeowners-only pilot still offered underwriting companies configured for
other products. Reference seeding creates all sample company/product rows;
carrier product enablement and admin company activation are independent.

## Resolution

Use the existing tenant-scoped, authorized underwriting company admin API to
deactivate out-of-scope configurations while retaining them for future setup.
Pilot preparation runs after bootstrap and seeds, then activates only Homeowners
in US/TX or ALL. This policy is driven by `deploy/pilot/standards.json`.
`deploy/pilot/README.md` records the same admin setup standard for future carriers.
No global sample reference rows or existing policy snapshots are deleted.

## Validation

The pilot helper test covers product, country and jurisdiction filtering.
Playwright checks admin inactive rows, the operational company API, company
dropdown options, and the sole Homeowners product option. Mandatory validation
uses an explicitly blank effective date because the single eligible company can
be selected automatically. Run `npm run test:carrier-stack` and
`npm run pilot:browser`; regenerate SHA-matched pilot handoff after deployment.
