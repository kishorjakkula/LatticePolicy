# Task Note: v0.2.2 Release Readiness

## Links

- Release tag: `v0.2.2`
- Previous release: `v0.2.1`
- GitHub release:

## Summary

Prepared the `v0.2.2` patch release to unblock GHCR release image publishing.
The `v0.2.1` application release validated successfully, but the tag-triggered
GHCR publish workflow failed when Trivy scanned unused npm CLI dependencies
bundled in the Node runtime base image for the API container.

## Release Scope

- Removes npm/npx from the final API runtime image after
  `npm ci --workspace=server --omit=dev` completes.
- Keeps npm available in build stages where it is needed.
- Aligns root, frontend, server, and shared type package metadata on `0.2.2`.

## Compatibility Notes

- No application API, database schema, product-pack, or migration behavior is
  changed by this patch.
- No npm packages are published. All workspaces remain private.
- GHCR release images are expected to publish from the `v0.2.2` semantic
  version tag.

## Validation Performed

Run from the repository root on 2026-08-21:

```bash
npm ci                  # passed, 0 vulnerabilities
npm run security:audit  # passed, 0 unapproved vulnerabilities
npm run build           # passed
```

Local `npm run test:e2e:docker` could not produce a trustworthy result because
Docker Desktop/containerd returned a host storage I/O error while committing
build layers (`metadata_v2.db: input/output error`). The GitHub release PR
checks are the authoritative Docker validation for this patch because they run
on a clean hosted runner.

GitHub release PR checks must pass before merge:

- Build, Test, Typecheck
- DB Integration Tests
- Playwright E2E Smoke
- Dependency Audit
- Dependency Review
- Analyze JavaScript/TypeScript
- Container Scan
- CodeQL
