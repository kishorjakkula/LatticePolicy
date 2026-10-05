# ACORD And GRLC Canonical Data Mapping

This document describes LatticePolicy's canonical data mapping layer for
ACORD Property & Casualty (P&C) and ACORD Global Reinsurance & Large
Commercial (GRLC) data exchange, added by issue #60. It lives in
`server/src/lib/acord-mapping/` and is intentionally kept separate from core
transaction logic so carriers can adapt or replace it without touching
policy/quote/reinsurance business rules.

## Supported Scope

This is a **canonical JSON mapping layer, structurally inspired by ACORD
field names** — not a generated ACORD XML/XSD binding and not a claim of
full ACORD standards compliance. It gives a contributor a clear, testable
place to see how industry-standard field names correspond to LatticePolicy's
internal objects, and a place to extend real ACORD XML/XSD parsing later if
a specific integration needs it.

Two flows are implemented end to end, per issue #60's acceptance criteria:

1. **Personal/commercial insurance flow** (`policy.mapper.ts`):
   - Inbound: `mapAcordSubmissionToQuoteIntake` — an ACORD P&C-style
     `PersPolicyQuoteInqRq`/`CommlPolicyQuoteInqRq`-shaped payload → the
     internal quote intake shape LatticePolicy's quote flow needs
     (`productCode`, `effectiveDate`, `termMonths`, `state`, insured party).
   - Outbound: `mapPolicyToAcordCanonical` — an internal policy row → an
     ACORD P&C-style canonical policy payload (`CanonicalPolicy`).
2. **Reinsurance/large commercial flow** (`reinsurance.mapper.ts`):
   - Inbound: `mapGrlcTreatyToInternal` — an ACORD GRLC-style
     `TreatyInfo`/layer/`SecurityInfo` payload → the internal treaty creation
     intake shape `reinsurance.service.ts` and `POST /api/v1/admin/reinsurance/treaties`
     consume (issue #61).
   - Outbound: `mapPlacementMatchToGrlcCanonical` — a resolved
     `PlacementMatch` from `reinsurance.service.ts#lookupPlacementMatches` /
     `#computePlacementForTransaction` → an ACORD GRLC-style canonical
     cession payload (`CanonicalReinsurancePlacement`), suitable for a
     bordereaux export or downstream reinsurance system.

`server/src/lib/acord-mapping/types.ts` also defines canonical shapes for
party, risk, coverage, transaction, premium impact, document, and exposure —
covering the full field-model list in issue #60's Expected Scope — with
inline comments noting the ACORD P&C or GRLC concept each maps to. Only the
two flows above have working mapper *functions* today; the remaining
canonical types exist as the documented target shape for follow-up mappers
(see Known Gaps) rather than being wired to a live route yet.

## ACORD P&C vs. GRLC

| Canonical type | ACORD P&C concept | ACORD GRLC concept |
| --- | --- | --- |
| `CanonicalParty` | `GeneralPartyInfo` / `NameInfo` / `InsuredOrPrincipal` | `SecurityInfo` party (reinsurer/broker) |
| `CanonicalPolicy` | `PolicySummaryInfo` | `Policy` (treaty-year policy record) |
| `CanonicalSubmission` | `PersPolicyQuoteInqRq` / `CommlPolicyQuoteInqRq` | `MarketSubmission` |
| `CanonicalRisk` | `RiskLocationInfo`, `VehInfo`, `DwellInfo` | `RiskInfo` (aggregate risk) |
| `CanonicalCoverage` | `CoverageInfo` | `CoverageInfo` (treaty terms) |
| `CanonicalTransaction` | `PolicyChgInfo` | Endorsement-equivalent treaty amendment |
| `CanonicalPremiumImpact` | `PremiumInfo` / `MiscCost` | Treaty premium/deposit terms |
| `CanonicalDocument` | `RemarkText` / `AttachmentInfo` | Slip/wording attachment |
| `CanonicalExposure` | — (not a core P&C concept) | `Exposure` / `AggregateExposure` |
| `CanonicalReinsurancePlacement` | — | `ReinsuranceCession` / `TreatyInfo` |
| `CanonicalReinsuranceParticipant` | — | `SecurityInfo` / `MarketInfo` |

## Mapper Interface Contract

Every mapper function follows the same shape:

- **Inbound** mappers take `unknown` (an untyped external payload) and
  return `MappingResult<T>` — either `{ ok: true, data: T, errors: [] }` or
  `{ ok: false, data: null, errors: MappingError[] }`. They never throw for
  malformed input; malformed input is always a structured `MappingError[]`
  result (field path, error code, human message, expected/actual).
- **Outbound** mappers take a known, already-validated internal shape and
  return the canonical payload directly (no `MappingResult` wrapper needed —
  internal data is trusted).

See `server/src/lib/acord-mapping/errors.ts` for the exact `MappingError`
shape and validation helpers (`requireField`, `requireString`,
`requirePercent`).

## Fixtures And Tests

`server/src/lib/acord-mapping/fixtures/` has one valid and one invalid
sample payload for each required flow:

- `acord-personal-submission.inbound.json` / `.invalid.json`
- `grlc-treaty-submission.inbound.json` / `.invalid.json`

`server/src/lib/acord-mapping/__tests__/` exercises both inbound and
outbound mapping, including structured-error assertions for the invalid
fixtures.

## Known Gaps

- No real ACORD XML/XSD parsing — payloads are canonical JSON shaped like
  ACORD's field names. A carrier needing literal ACORD XML interchange
  would add an XML↔JSON adapter step in front of these mappers.
- `CanonicalRisk`, `CanonicalCoverage`, `CanonicalTransaction`,
  `CanonicalPremiumImpact`, `CanonicalDocument`, and `CanonicalExposure` are
  defined as target types but have no mapper functions yet — only the
  policy and reinsurance placement flows are wired end to end, per this
  issue's minimum acceptance criteria (at least one personal/commercial flow
  and one reinsurance/large commercial flow).
- No live HTTP route calls these mappers yet (e.g. an
  `POST /api/v1/integrations/acord/submissions` endpoint); they're available
  as a library for a future integration route to call.
- `mapPlacementMatchToGrlcCanonical` omits broker name and lead-market flag
  on participants because `reinsurance.service.ts#lookupPlacementMatches`
  doesn't currently surface those fields on `PlacementMatch` — they exist on
  the underlying `reinsurance_market_participants` row but need a service
  change to surface, which is out of scope here.
