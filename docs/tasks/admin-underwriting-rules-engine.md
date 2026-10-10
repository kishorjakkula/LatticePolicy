# Admin Underwriting Rules Engine

## Summary

Added tenant-scoped, effective-dated Refer and Decline rules backed by a
curated product field catalog. Products without matching configured rules
continue to use the established code-based underwriting checks.

## Safety Rules

- Rules are tenant isolated and require dedicated read/manage permissions.
- Field paths and operators must come from the product's curated catalog.
- Rule windows are evaluated against the policy effective date, not the
  server's wall-clock date.
- Existing tenant YAML overrides remain active while a product still uses the
  fallback path.
- Default seeding is limited to products whose current fallback checks can be
  represented completely. A seed action must never remove an existing check.
- Database failures propagate except for the explicit pre-migration
  undefined-table compatibility case.

## Important Files

- `server/migrations/057_underwriting_rules.sql`
- `server/src/services/uw.service.ts`
- `server/src/services/underwriting-rule-fields.ts`
- `server/src/routes/uw.routes.ts`
- `server/src/routes/admin.routes.ts`

## Validation

- Unit coverage for fallback parity, operators, field resolution, and policy
  effective-date selection
- Route coverage for permissions, validation, CRUD, and nullable-field edits
- DB integration, build, typecheck, Playwright, security, CodeQL, and
  container checks

## Follow-Up

Personal auto, commercial auto, and professional liability contain compound
or format-based fallback checks that the first generic operator set cannot
represent. Extend the rule model and catalog before enabling default seeding
for those products.

