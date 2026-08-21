# Standardize Release Process

## Summary

Standardized the release process so ordinary pull requests do not become
GitHub releases. Releases are now explicit, batched maintainer actions with a
release issue, `release/vX.Y.Z` stabilization branch, dedicated release PR,
validation gate, changelog update, version bump, tag, GitHub release, and GHCR
image publish.

## Changes

- Added release cadence and eligibility rules to `docs/RELEASE_PROCESS.md`.
- Documented the lightweight release-branch model: normal PRs target `main`,
  release-approved stabilization fixes target the active release branch, and the
  final release branch is merged back into `main` before tagging.
- Added release impact choices to the pull request template.
- Added a release checklist issue template for planned minor and patch
  releases.

## Policy

- Normal PRs should be marked as included in the next planned release or as no
  release impact.
- Patch release candidates are reserved for urgent fixes to already-published
  releases, security issues, failed release artifacts, broken setup paths, or
  adopter-impacting regressions.
- Version bumps, changelog release entries, tags, GitHub Releases, and GHCR
  publish actions belong only in dedicated release PRs.
- Release branches use `release/vX.Y.Z` naming and should contain only selected
  release scope plus release-approved stabilization changes.

## Validation

- Documentation-only change; no product runtime checks required.
