# Task Note: Carrier And Reinsurance Roadmap Layout

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/69
- Pull request:

## Summary

Added a repository-visible roadmap so contributors and AI coding agents can
understand how the carrier, insurance platform, reinsurance, ACORD/GRLC,
security, product governance, and production operations issues fit together.

## Important Files

- `docs/ROADMAP.md`: phase-based roadmap with GitHub epic and task links.
- `README.md`: links the roadmap from the primary documentation list.
- `docs/PROJECT_CONTEXT.md`: points future AI agents to the roadmap.

## Behavior Rules

- The roadmap is documentation-only and does not change runtime behavior.
- Billing, payment accounting, claim financial accounting, and commission
  settlement remain outside LatticePolicy unless a future issue explicitly
  changes that boundary.
- LatticePolicy still owns reliable policy transaction, premium-impact,
  exposure, document, audit, and integration-event context needed by external
  systems.

## Automated Tests

- Tests added or updated: none.
- Test layer used: not applicable.
- Why this layer is enough: documentation-only change with no product behavior.

## Validation

```bash
git diff --check
```

## Follow-Ups Or Risks

- GitHub Project fields, milestones, and labels still need to be created
  manually or with a GitHub automation tool because the current connector only
  exposed issue-level operations.
