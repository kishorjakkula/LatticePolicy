# WP-0010 Businessowners Product Pack

## Scope

Bounded configuration/rating contribution to the approved BOP design. Product
`businessowners`, risk `businessownersLocation` -> `BOP.Location`, rate-table,
catalog forms, original synthetic version 1.0.0. No new service or dependency;
the demo setup writes only when explicitly run in a local or test environment.

## Files And Contracts

- `products/businessowners/coverage.yaml`: capabilities, availability,
  `packageRules`, coverages/terms and explicit all-tenant `fields` metadata.
- `products/businessowners/rates.yaml`: strict explicit component pricing.
- `products/businessowners/README.md`: authoritative assumptions, alternative
  factor values and independently calculated golden totals, written before tests.
- `products/businessowners/documents/BOP-{QUOTE,BINDER,DEC}.txt`: original
  non-contractual source text; not binary templates or proof of form integration.
- `tenants/sample-carrier/field_meta.businessowners.json`: exact mirror of `fields`.
- `server/src/lib/__tests__/businessowners-rating.test.ts`: bounded pack/rater
  tests, not substitutes for shared validation, API or lifecycle tests.

Locked parent contract: `packageRules` contains `riskType`, `riskCount`,
`termMonths`, `states`, `requiredCoverages`, `buildingCoverage`,
`buildingInterestField`, `ownerOccupancy`, `occupancyField`, and
`requiredUnderwritingRules`. Core coverages have `required: true`; building,
equipment and water are `optional: true`. Fixed coverage `packageTerms` objects,
liability `aggregateMultiplier: 2` and `personalAdvertisingInjuryMultiplier: 1`
are consumed/derived by parent-owned enforcement and types. Do not trust browser
terms or replace historical snapshots with the current definition.

Risk keys: businessName, businessClass, annualRevenue, annualPayroll,
employeeCount, yearsInBusiness, priorLossCount, priorLossAmount, occupancy,
buildingInterest, locationAddress, yearBuilt, squareFeet, construction,
protectionClass, roofAgeYears, sprinklers, fireAlarm, burglarAlarm, vacancyDays,
hazardousOperations. All are explicitly typed/required; no fact defaults.
`locationAddress` has type object/format postal-address using the existing
PostalAddress keys. Parent loader/UI must handle that structured control and
read cfg.fields as fallback for all tenants and tenant-less intake catalogs.

## Behavior And Verification

Baseline factors 1: owner 1,800; tenant 800. Minimum 500; zero demo fee/tax.
No fallback price. Required factor lookups fail on missing/unknown values.
All shared factors affect only building/BPP/income; liability, medical and
fixed-price optional extensions explicitly opt out. Income/extra expense and
included liability benefits/medical are not charged twice. README records
alternative rates, deductible factors, coverage rounding and golden totals.

## Integration (completed in WP-0010)

- Package enforcement: `server/src/lib/product-package.ts` validates the
  package and derives `packageTerms` before pricing (`rating.service.ts`) and in
  the product rules used at bind, issue and every policy transaction
  (`product-rules.service.ts`). Browser-sent terms must match or are refused.
- Distribution: `businessowners-authorization.service.ts` checks the actor,
  Ohio eligibility, company, agency, producer, affiliation, appointments and the
  producer-user link, with share locks, before pricing and again inside the
  write transaction (`quote.service.ts`, `quote-bind.service.ts`). It runs after
  the WP-0008 rating check at bind. Renewal, rewrite and endorsement do not
  re-run it; they use the existing authority grants and referral gates.
- Underwriting: `uw.service.ts` refuses to fall back when the pack sets
  `requiredUnderwritingRules`; the demo setup seeds the referral/decline rules.
- Forms: BOP-QUOTE/BINDER/DEC are opt-in (`seedProductDocumentTemplates` with
  `productCodes`); document tokens read the saved transaction, never the
  current definition.
- UI: generic coverage editor shows required/included parts, building interest
  and package terms; policy view and submission review show BOP details.
- Demo setup: `server/scripts/seed-businessowners-demo.ts` (local/test only,
  explicit opt-in, existing users, idempotent, never overwrites edited rows).

## Verification

From `server/` with Node 24: unit `npx vitest run`; database
`npm run test:integration` against a disposable `lattice_policy_integration`
database with `LATTICE_DISPOSABLE_TEST_DATABASE=true TENANT_RLS_ENFORCED=true`
(`businessowners-demo` and `businessowners-lifecycle` cover setup, referral and
decline rules, and quote, bind, issue, endorse, cancel, reinstate, renew,
rewrite and non-renew). Browser: `npx playwright test -c
playwright.businessowners.config.ts` (mocked API, 1440px and 390px).

## Limits

Single Ohio premises, 12-month term, synthetic rates and forms. Real carrier
use needs legal, filing and distribution approval; passing synthetic tests is
not an insurance certification.
