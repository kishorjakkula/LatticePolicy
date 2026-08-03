# Release Process

This process keeps LatticePolicy releases understandable for contributors,
adopters, and future AI agents. The project is pre-1.0, so releases should be
treated as adoption checkpoints rather than a promise of production readiness.

## Versioning

- Use semantic version tags such as `v0.2.0`.
- Minor versions, such as `0.2.0`, group meaningful framework, workflow, and
  contributor-readiness changes.
- Patch versions, such as `0.2.1`, are for narrow fixes that do not change
  public setup, APIs, migrations, or product-pack contracts.
- Until `1.0.0`, breaking changes are allowed, but release notes must call them
  out clearly.

## Release Branch

Create a focused release branch from current `origin/main`:

```bash
git fetch origin --prune
git switch -c codex/v0.2.0-release-readiness origin/main
```

Keep release branches limited to release readiness work: dependency/security
updates, CI gates, docs, version metadata, release notes, and final bug fixes
approved for the release.

## Quality Gate

Run the release checks from the repository root:

```bash
npm install
npm run security:audit
npm run build
npm run test
npm run typecheck
npm run test:integration
npm run test:e2e:docker
docker compose up -d --build
curl http://localhost:3300/health
docker compose down
```

If a check is intentionally deferred, document the reason in `CHANGELOG.md`, the
release task note, and the GitHub release notes.

## Required Release Updates

- Bump root and workspace package versions.
- Update `CHANGELOG.md`.
- Update release-specific docs or task notes under `docs/tasks/`.
- Review `docs/OPEN_SOURCE_READINESS.md` for current audit and publishing
  status.
- Confirm the GitHub release notes include known limitations.
- Confirm no secrets, generated build output, local logs, or `node_modules`
  were committed.

## Migration Compatibility

Production deployments should treat SQL migrations as deliberate release steps.
For each release:

- review new migration files for tenant isolation and repeatability,
- run DB-backed integration tests against an empty database,
- document migration impact in the changelog when schemas or seed behavior
  change,
- prefer forward-only migrations unless maintainers explicitly approve a
  rollback script.

## GitHub Release

After the PR merges:

1. Confirm `main` CI, security, integration, and E2E checks are green.
2. Create a signed or maintainer-owned tag:

   ```bash
   git checkout main
   git pull --ff-only
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Create a GitHub release titled:

   ```text
   v0.2.0 - Contributor and Pilot Readiness Foundation
   ```

4. Include:

   - summary,
   - validation performed,
   - security status,
   - known limitations,
   - upgrade notes,
   - next planned focus.

## Post-Release

- Close completed release-prep issues.
- Move deferred items into the next milestone.
- Run the roadmap metadata sync workflow after label/milestone changes are
  reviewed.
- Keep `docs/ROADMAP.md` aligned with GitHub issue status.
