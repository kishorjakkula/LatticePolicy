# GHCR Release Image Publishing

## Summary

Added a GitHub Actions workflow that publishes LatticePolicy API and frontend
Docker images to GitHub Container Registry (GHCR) from reviewed release tags.

## Why

GitHub Releases give adopters source code archives, but contributors and pilot
users also need immutable container images that can be pulled without rebuilding
locally. GHCR is appropriate for this project because LatticePolicy already has
separate Dockerfiles for the API and frontend and does not currently publish npm
packages.

## Changed Files

- `.github/workflows/publish-ghcr.yml`: builds, scans, and publishes API and
  frontend release images.
- `docs/RELEASE_PROCESS.md`: documents GHCR publishing flow and safeguards.
- `docs/OPEN_SOURCE_READINESS.md`: records the container registry publishing
  decision.

## Publishing Contract

The workflow publishes:

- `ghcr.io/kishorjakkula/latticepolicy-api:<release-tag>`
- `ghcr.io/kishorjakkula/latticepolicy-api:<commit-sha>`
- `ghcr.io/kishorjakkula/latticepolicy-frontend:<release-tag>`
- `ghcr.io/kishorjakkula/latticepolicy-frontend:<commit-sha>`

It does not publish npm packages and does not publish mutable `latest` tags.

The workflow runs automatically for future semantic version tags such as
`v0.2.1`. Because `v0.2.0` was tagged before this workflow existed, maintainers
can publish that existing tag by manually running `Publish GHCR Images` with
`release_tag` set to `v0.2.0` after this change merges.

## Safety Decisions

- The workflow uses `GITHUB_TOKEN` with `packages: write`, avoiding long-lived
  package publishing secrets.
- Checkout is pinned to the release tag being published.
- API and frontend images are scanned for high and critical findings before
  push.
- `.env` and `.env.*` files are excluded from the root Docker build context.
- Images are labeled with source repository, revision, version, and license
  metadata.

## Validation

- YAML syntax parsed locally with Python.
- Workflow structure reviewed against existing Docker build commands and
  release process documentation.

## Follow-Up

- After merge, run the manual workflow for `v0.2.0`.
- Review GHCR package visibility and repository linkage in GitHub Packages.
- Decide later whether `packages/types` should become a public npm package.
