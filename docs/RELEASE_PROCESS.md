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

## Release Cadence and Eligibility

Do not cut a GitHub release for every merged pull request. Ordinary feature,
bug fix, documentation, test, dependency, and refactor PRs should merge into
`main` and wait for the next planned release.

Use this default cadence:

- **Minor release:** batch completed work into a planned adoption checkpoint
  when there is a meaningful user-facing, contributor-facing, or operational
  milestone.
- **Patch release:** cut only for a narrow fix to an already-published release,
  such as a failed release artifact, serious regression, security fix, broken
  setup path, or migration/documentation correction that materially affects
  adopters.
- **No release:** skip releases for routine PRs, internal cleanup, issue
  triage, docs polish, isolated tests, and dependency updates that do not need
  adopters to move immediately.

A release candidate must have a maintainer-owned release issue or milestone
before version metadata is changed. The release issue should name the intended
version, summarize included PRs, list deferred work, and record validation.

## Branching Model

Use a lightweight release-branch model:

- `main` is the integration branch for completed development and should stay
  releasable.
- Release branches use `release/vX.Y.Z`, for example `release/v0.3.0`.
- Create the release branch from current `origin/main` when maintainers decide
  the next release scope is ready for stabilization.
- Feature PRs normally target `main`, not the release branch.
- During release stabilization, only release-approved bug fixes, validation
  fixes, dependency/security fixes, documentation corrections, and release
  metadata updates should target the release branch.
- Changes made directly on a release branch must also be merged or
  cherry-picked back to `main` unless the final release branch merge already
  carries them back.
- Work that misses the release branch remains on `main` for the next planned
  release.

This keeps normal development moving while giving each release a controlled
stabilization window.

## Pull Request Release Impact

Every PR should state its release impact in the pull request description:

- **Included in next planned release:** default for product, API, workflow, and
  contributor improvements.
- **Patch release candidate:** only when the PR fixes a released artifact or
  urgent adopter-impacting problem.
- **No release impact:** docs-only, tests-only, chores, or internal refactors.

Do not bump package versions, update top-level release notes, create release
tags, or publish GHCR images from a normal feature or fix PR. Those actions
belong only in a dedicated release PR.

## Release Branch

Create a focused release branch from current `origin/main`:

```bash
git fetch origin --prune
git switch -c release/v0.3.0 origin/main
git push -u origin release/v0.3.0
```

Keep release branches limited to release readiness work: version metadata,
release notes, validation fixes, dependency/security updates needed for the
release, and final bug fixes explicitly approved in the release issue.

Open release stabilization PRs against the release branch only when they are
approved for the release. Otherwise, merge normal PRs to `main` and leave them
for the next planned release.

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

The release PR should reference the release issue and should not include
unrelated feature work. If a late fix is required, merge it as its own PR first
when practical, then include it in the release branch by rebasing or recreating
the release branch from updated `main`.

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

When the release branch is ready:

1. Open a release PR from `release/vX.Y.Z` into `main`.
2. Confirm release-branch CI, security, integration, E2E, and CodeQL checks are
   green.
3. Merge the release branch PR into `main`.
4. Confirm `main` still points to the intended released state and that post-merge
   checks are green.
5. Create a signed or maintainer-owned tag from the released `main` commit:

   ```bash
   git checkout main
   git pull --ff-only
   git tag v0.3.0
   git push origin v0.3.0
   ```

6. Create a GitHub release titled:

   ```text
   v0.3.0 - Contributor and Pilot Readiness Foundation
   ```

7. Include:

   - summary,
   - validation performed,
   - security status,
   - known limitations,
   - upgrade notes,
   - next planned focus.

## GitHub Container Registry

LatticePolicy publishes release container images to GitHub Container Registry
(GHCR) for adopters who want to run a tagged release without building images
locally. The workflow publishes two images:

- `ghcr.io/kishorjakkula/latticepolicy-api:<tag>`
- `ghcr.io/kishorjakkula/latticepolicy-frontend:<tag>`

The publish workflow runs automatically for new semantic version tags such as
`v0.2.1`. It can also be run manually through the `Publish GHCR Images`
workflow when publishing an existing tag, such as `v0.2.0`, after the workflow
is introduced.

Before publishing images:

- confirm the release tag points to the intended `main` commit,
- confirm CI, integration, E2E, and security checks are green,
- confirm no `.env`, secret, local data, build output, or generated log files
  are part of the Docker build context,
- review high and critical container scan findings.

Published images are tagged with both the release tag and the Git commit SHA.
Do not publish mutable `latest` tags until maintainers intentionally define a
stable production release policy.

## Post-Release

- Close completed release-prep issues.
- Move deferred items into the next milestone.
- Run the roadmap metadata sync workflow after label/milestone changes are
  reviewed.
- Keep `docs/ROADMAP.md` aligned with GitHub issue status.
