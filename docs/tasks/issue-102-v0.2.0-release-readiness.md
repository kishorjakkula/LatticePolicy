# Issue 102: v0.2.0 Release Readiness

## Summary

Prepared the `v0.2.0` contributor and pilot-readiness release branch by adding
release documentation, CI release gates, security automation, roadmap metadata
sync tooling, and package version metadata.

## Related Issues

- #97 CI security automation
- #98 React Router advisory handling
- #99 DB integration tests in CI
- #100 Playwright E2E smoke tests in CI
- #101 GitHub labels and milestones sync
- #102 Release, versioning, changelog, and migration process
- #104 License recognition

## Files Changed

- `CHANGELOG.md`
- `docs/RELEASE_PROCESS.md`
- `docs/OPEN_SOURCE_READINESS.md`
- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/sync-roadmap.yml`
- `.github/dependabot.yml`
- `scripts/check-npm-audit.mjs`
- `scripts/sync-github-roadmap.mjs`
- root and workspace package metadata
- `LICENSE`

## Behavior Rules

- Normal CI now includes build, unit/component tests, typecheck, DB integration,
  and Playwright E2E smoke.
- Security automation now checks dependency policy, dependency review, CodeQL,
  and container images.
- Dependency Review is configured as advisory until the repository Dependency
  Graph is enabled in GitHub security settings. The enforced dependency gate is
  `npm run security:audit`.
- Container scanning is advisory for v0.2.0 so image findings are visible while
  maintainers establish a baseline and decide which base-image or transitive
  package findings should block future releases.
- The React Router advisory is an explicit temporary exception, not ignored by
  accident. Remove the exception as soon as a patched non-regressing
  `react-router-dom` release is available.
- GitHub labels and milestones remain source-controlled in YAML and can be
  synced through a manual workflow.

## Validation Commands

```bash
npm run security:audit
npm run build
npm run test
npm run typecheck
npm run test:integration
npm run test:e2e:docker
```

## Known Follow-Ups

- Production runtime config validation remains tracked by #103.
- OpenAPI drift checks remain tracked by #105.
- Roadmap discussion cleanup remains tracked by #106.
