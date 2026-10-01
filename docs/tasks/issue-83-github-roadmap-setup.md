# Task Note: GitHub Roadmap Setup

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/83
- Project: https://github.com/users/kishorjakkula/projects/1
- Pull request: https://github.com/kishorjakkula/LatticePolicy/pull/298

## Summary

Issue #83 establishes a repeatable GitHub roadmap planning structure visible
to contributors. The public Project contains every open roadmap issue and epic,
with fields for status, priority, readiness, domain, size, and owner. The
repo-owned label and milestone definitions remain the source for issue
metadata, while the documentation links directly to the live board.

## Important Files

- `.github/labels.yml`: canonical labels for type, priority, readiness, domain,
  and contribution state.
- `.github/milestones.yml`: canonical roadmap milestones.
- `docs/GITHUB_ROADMAP_SETUP.md`: maintainer-facing setup and triage process.
- `docs/ROADMAP.md`: links roadmap execution to the GitHub setup guide.
- `README.md`: exposes the setup guide from the documentation index.
- GitHub Project #1: public planning data for all open roadmap work.

## Behavior Rules

- Repository docs remain the source of truth for roadmap and functionality.
- GitHub Project fields, labels, and milestones should mirror the repo-owned
  definitions.
- Wiki pages summarize stable merged content and should not replace repo docs.
- New behavior changes still require automated tests and AI-readable Markdown
  context.

## Automated Tests

- Tests added or updated: none.
- Test layer used: documentation/configuration review.
- Why this layer is enough: this change does not alter application runtime
  behavior.

## Validation

```bash
git diff --check
DRY_RUN=1 GITHUB_REPOSITORY=kishorjakkula/LatticePolicy npm run sync:github-roadmap
```

## Follow-Ups Or Risks

- GitHub Project custom views are maintained in the GitHub UI; the default
  table and configured fields support filtering by domain, readiness, and
  priority without additional repository changes.
- Keep new roadmap issues synchronized with the project during triage.
