# Modernize Policy ID Cards

## Summary

Updated customer-facing auto insurance ID cards to use a clearer,
print-friendly information hierarchy. The customer portal and policy workflow
now generate the same visual treatment.

## Changes

- Added a high-contrast carrier header with a protected logo area.
- Grouped insured, policy, term, vehicle, VIN, and supporting details into a
  consistent two-column layout.
- Constrained long values to their assigned columns to prevent overlap.
- Added a subtle divider and in-vehicle reminder without adding unsupported
  policy or regulatory language.
- Retained letter-size output and multi-vehicle pagination.
- Replaced placeholder carrier branding across generated documents with the
  LatticePolicy wordmark and added a matching browser favicon.

## Verification

- `npm run typecheck --workspace=frontend`
- `npm run test --workspace=frontend -- --run` (130 tests passed)
- `npm run build --workspace=frontend`
- `docker compose up -d --build frontend`
- Generated an ID-card PDF from the live customer portal.
