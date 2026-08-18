# Task Note: Carrier Onboarding And Go-Live Certification Kit

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/66
- Pull request:

## Summary

Added `docs/CARRIER_ONBOARDING_KIT.md`, the practical implementation path
for a carrier/reinsurer/MGA/MGU adopting LatticePolicy: onboarding
checklist, tenant/product setup pointer, versioning checklist, ACORD/GRLC
and reinsurance worksheets, integration event checklist, security/go-live
checklist, and a certification test suite plan mapped to
`docs/TEST_PLAN.md`.

## Important Files

- `docs/CARRIER_ONBOARDING_KIT.md`: the kit itself.
- `README.md`: links the kit from the documentation index.

## Behavior Rules

- The kit is a reference/checklist document; it does not duplicate setup
  mechanics already covered by `docs/DEVELOPER_SETUP.md` or
  `docs/PRODUCT_PACK_CONTRACT.md`, it links to them.
- ACORD/GRLC and reinsurance sections are explicitly framed as worksheets
  for still-open roadmap work ([#60](https://github.com/kishorjakkula/LatticePolicy/issues/60),
  [#61](https://github.com/kishorjakkula/LatticePolicy/issues/61),
  [#62](https://github.com/kishorjakkula/LatticePolicy/issues/62),
  [#63](https://github.com/kishorjakkula/LatticePolicy/issues/63)) — they do
  not claim mapping/treaty functionality that does not exist yet in this
  codebase.
- Readiness tiers (Demo/Pilot/Production) match the `readiness:*` label
  taxonomy in `docs/GITHUB_ROADMAP_SETUP.md`.

## Automated Tests

- Tests added or updated: none.
- Test layer used: documentation review.
- Why this layer is enough: this change is documentation-only and does not
  alter application runtime behavior.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

## Follow-Ups Or Risks

- Section 7 references issue #68 (production runbooks), which is still open
  at the time of this change; link the actual runbook doc from the kit once
  it merges.
- The ACORD/GRLC and reinsurance worksheets are planning aids only until
  #60-#64 land; keep them in sync with that implementation once it starts.
