# Task Note: HO-3 Homeowners Product, Common Quote Fields, HO Documents

## Links

- Issue: none yet
- Pull request:
- Builds on: #376 (AI-assisted submission intake)
- References: `research_notes/industry-document-references-2026-10-17/` (structure only; no wording copied)

## Summary

The homeowners product is upgraded to the HO-3 special form structure
(version 2.0.0). Four fields become common to every product. Homeowners
gets original Word templates filled at bind, and intake drafts coverages
and the common fields so submissions flow into all of it.

## Important Files

- `products/homeowners/coverage.yaml`, `rates.yaml`: version 2.0.0. Coverages
  A-F with valuation and peril basis; optional endorsements END_WB, END_PPRC,
  END_ORD, END_ERC; loss settlement, additional coverages, special limits,
  named perils, not-covered list; new rating keys.
- `server/src/services/rating.service.ts`: `hoVersion2Factor` and endorsement
  weights.
- `server/src/lib/products.ts`: new dwelling fields (roof type, dwelling
  units, stories, distance to fire station).
- `frontend/src/features/wizard/QuoteWizard.tsx`: homeowners coverage defaults
  from the product file, endorsements section, "Included in this policy".
- `frontend/src/features/wizard/CommonQuoteSections.tsx`: prior insurance
  extras, billing, mailing address, additional interests, review summary.
- `server/src/services/quote-bind.service.ts`: writes quote additional
  interests to `policy_additional_interests` in the bind transaction; passes
  the premium to document generation.
- `server/src/services/document-template-variables.ts`: Policy details and
  Homeowners token groups (`resolvePolicyDetailTokens`), premium fallback.
- `products/homeowners/documents/*.docx`, `scripts/build-homeowners-templates.mjs`:
  declarations, binder, mortgagee evidence of insurance, quote proposal.
- `server/src/services/product-document-templates.service.ts`: seeding of the
  HO-DEC, HO-BINDER and HO-EOI forms and templates.
- `server/src/lib/intake/target-fields.ts`: coverage fields for every product,
  common fields, insured date of birth, aliases.
- `examples/intake-samples/`: homeowners, homeowners-new-purchase (Word),
  homeowners-conflicts, commercial-auto-lienholder.

## Behavior Rules

- Version 2 rating factors apply only when their tables are in the rates a
  quote is pinned to: quotes on version 1 price exactly as before. Policies
  written before product pinning existed have no pin and rate on the current
  definition on their next transaction.
- Optional endorsements are never selected by default.
- Reference data (additional coverages, special limits, perils) is display
  and document content; it does not change rating.
- Additional interests with no name or an unknown role are not written to the
  policy.
- Seeding never replaces a template a form already has.
- Templates and product text are LatticePolicy's own wording, marked
  illustrative; a carrier replaces them with approved filed text.
- Intake coverage fields are optional; the wizard applies product defaults to
  coverages a submission does not ask for.

## Automated Tests

- `server/src/services/__tests__/rating-homeowners-v2.test.ts`: version 1
  unchanged, each factor, endorsements.
- `server/src/services/__tests__/quote-additional-interests.test.ts`,
  `server/src/__tests__/quote-to-bind.integration.test.ts`: interests at bind.
- `server/src/services/__tests__/document-policy-detail-tokens.test.ts`,
  `homeowners-document-templates.test.ts`,
  `document-template-variables.test.ts`: tokens, templates, premium fallback.
- `server/src/__tests__/product-document-templates.integration.test.ts`:
  seeding is idempotent.
- `server/src/lib/intake/__tests__/intake-homeowners.test.ts`: the homeowners
  sample drafts fully with no conflicts.
- `frontend/src/features/wizard/__tests__/CommonQuoteSections.test.tsx`.

## Validation

```bash
npm run build
npm run typecheck
npm run check:architecture
npm run test
npm run test:integration --workspace=server   # fresh Postgres
node scripts/build-homeowners-templates.mjs     # regenerate templates
```

## Follow-Ups Or Risks

- Quote-stage document generation does not exist yet, so `HO-QUOTE.docx` is
  shipped but not seeded.
- Endorsement forms are listed on the declarations; separate endorsement form
  documents with coverage-based attachment rules are not built.
- State-specific HO variations (amendatory endorsements, notices) are not
  modelled.
- The wizard coverage step can overwrite selections made within about a
  second of entering it (existing behavior).
