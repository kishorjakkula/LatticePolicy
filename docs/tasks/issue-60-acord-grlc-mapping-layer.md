# Task Note: ACORD And GRLC Canonical Data Mapping Layer

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/60
- Pull request:

## Summary

Added the first canonical ACORD P&C / ACORD GRLC data mapping layer under
`server/src/lib/acord-mapping/`, kept separate from core transaction logic
so carriers can adapt or replace it. Two flows are implemented end to end:
a personal/commercial insurance submission/policy flow, and a
reinsurance/large-commercial treaty flow that maps onto issue #61's
reinsurance model (`server/src/services/reinsurance.service.ts`).

This branch was built on top of issue #61's still-unmerged
`feature/reinsurance-treaty-facultative-model` branch (PR #167), since the
reinsurance mapper depends on real types/behavior from that work
(`PlacementMatch`, `lookupPlacementMatches`, `computePlacementForTransaction`
— see `docs/REINSURANCE_MODEL.md`). It needs a rebase onto `main` once #167
merges, to drop the now-duplicate #61 diff from this PR.

## Important Files

- `server/src/lib/acord-mapping/types.ts`: canonical mapping types (party,
  policy, submission, risk, coverage, transaction, premium impact, document,
  exposure, reinsurance placement/participant) with inline ACORD P&C/GRLC
  cross-reference comments.
- `server/src/lib/acord-mapping/errors.ts`: `MappingResult<T>` /
  `MappingError` structured-error contract and validation helpers shared by
  every mapper.
- `server/src/lib/acord-mapping/policy.mapper.ts`: personal/commercial flow
  — `mapAcordSubmissionToQuoteIntake` (inbound), `mapPolicyToAcordCanonical`
  (outbound), plus `mapGrlcSubmissionToInternal` for a large-commercial
  submission variant.
- `server/src/lib/acord-mapping/reinsurance.mapper.ts`: reinsurance flow —
  `mapGrlcTreatyToInternal` (inbound, maps onto
  `reinsurance.service.ts`'s treaty/layer/participant creation shape),
  `mapPlacementMatchToGrlcCanonical` (outbound, maps a resolved
  `PlacementMatch` to a canonical GRLC cession payload).
- `server/src/lib/acord-mapping/fixtures/`: sample valid/invalid payloads
  for both flows, used by the tests.
- `docs/ACORD_GRLC_MAPPING.md`: full reference — supported scope, ACORD
  P&C-vs-GRLC field table, mapper interface contract, known gaps.
- `README.md`, `docs/CARRIER_ONBOARDING_KIT.md`: doc-index link and
  ACORD/GRLC worksheet section updated to point at the real implementation.

## Behavior Rules

- Inbound mappers never throw on malformed input — they always return a
  `MappingResult`, with structured `MappingError[]` (field, code, message,
  expected/actual) on failure.
- Outbound mappers take already-validated internal data and return the
  canonical payload directly, no result wrapper.
- The mapping layer must not redefine core domain entities — it maps onto
  the real `server/src/schema.ts` rows and `reinsurance.service.ts` types,
  it does not invent a parallel domain model.
- `mapPlacementMatchToGrlcCanonical` intentionally omits broker
  name/lead-market flag on participants because `PlacementMatch` doesn't
  surface those fields today (see Known Gaps in `docs/ACORD_GRLC_MAPPING.md`).

## Automated Tests

- Tests added:
  - `server/src/lib/acord-mapping/__tests__/policy.mapper.test.ts` (7 tests)
  - `server/src/lib/acord-mapping/__tests__/reinsurance.mapper.test.ts` (5 tests)
- Test layer used: unit tests with fixture-based payloads (no DB needed —
  mapping is pure data transformation).
- Why this layer is enough: mapper functions are pure; the fixtures cover
  both the required inbound and outbound cases for each flow plus
  structured-error assertions for malformed input, per the issue's
  acceptance criteria and suggested test coverage.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

All green: 82 frontend + 194 server tests passing (12 new), typecheck clean.

## Follow-Ups Or Risks

- **Needs a rebase onto `main` once PR #167 (issue #61) merges** — this
  branch currently includes #167's full diff since it was built on top of
  that unmerged branch to access real reinsurance types.
- `CanonicalRisk`, `CanonicalCoverage`, `CanonicalTransaction`,
  `CanonicalPremiumImpact`, `CanonicalDocument`, `CanonicalExposure` are
  defined as target types in `types.ts` but have no mapper function yet —
  only the two required flows (personal/commercial, reinsurance/large
  commercial) are wired end to end.
- No live HTTP integration route calls these mappers yet; they're available
  as a library for a future `/api/v1/integrations/acord/*`-style route.
- No real ACORD XML/XSD parsing — see `docs/ACORD_GRLC_MAPPING.md`'s Known
  Gaps section for the full list.
