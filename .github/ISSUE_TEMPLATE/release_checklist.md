---
name: Release checklist
about: Plan and validate a batched LatticePolicy release
title: "Release vX.Y.Z"
labels: release
assignees: ""
---

## Release Goal

- Version:
- Release type: minor / patch
- Release branch: `release/vX.Y.Z`
- Target date:
- Maintainer:

## Included Work

List merged PRs or issue groups included in this release.

- 

## Deferred Work

List known items intentionally left for a future release.

-

## Release Impact

- Public API changes:
- Database migrations:
- Product-pack or tenant config changes:
- Deployment or environment changes:
- Known limitations:

## Validation

- [ ] `npm ci`
- [ ] `npm run security:audit`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run typecheck`
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e:docker`
- [ ] `docker compose up -d --build`
- [ ] `curl http://localhost:3300/health`
- [ ] `docker compose down`

Deferred validation, if any:

-

## Release PR Checklist

- [ ] Dedicated release PR only
- [ ] Release branch created from current `origin/main`
- [ ] Root and workspace package versions bumped
- [ ] `CHANGELOG.md` updated
- [ ] Release task note added under `docs/tasks/`
- [ ] `docs/OPEN_SOURCE_READINESS.md` reviewed
- [ ] GitHub release notes drafted
- [ ] No unrelated feature work included
- [ ] Release-approved branch fixes are also present on `main` or will be
      carried back by the release branch merge

## Post-Merge Checklist

- [ ] Confirm `main` CI, security, integration, E2E, and CodeQL checks are green
- [ ] Create maintainer-owned semantic version tag
- [ ] Publish GitHub release
- [ ] Confirm GHCR publish workflow succeeds
- [ ] Move deferred items into the next milestone
