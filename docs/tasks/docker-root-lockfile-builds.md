# Docker Root Lockfile Builds

## Summary

Standardized Docker builds so both API and frontend images install dependencies
from the root npm workspace lockfile.

## GitHub Issue

- #119: Standardize Docker dependency installs on the root npm workspace
  lockfile

## Why

The repository documents the root `package-lock.json` as the source of truth,
but the Dockerfiles previously depended on nested workspace lockfiles. After
Dependabot updated the root workspace lockfile, the frontend and server Docker
builds could still fail because their nested lockfiles were stale.

## Changed Files

- `server/Dockerfile`: installs server dependencies from the root workspace
  lockfile.
- `frontend/Dockerfile`: installs frontend dependencies from the root workspace
  lockfile.
- `docker-compose.yml`: builds the frontend image from the repository root.
- `.github/workflows/security.yml`: scans the frontend image using the root
  build context.
- `.github/workflows/deploy-aws-ecs.yml`: deploys the frontend image using the
  root build context.
- `.github/workflows/publish-ghcr.yml`: publishes the frontend image using the
  root build context and tags images with the checked-out release commit.
- `docs/CLOUD_DEPLOYMENT.md`: updates documented frontend image build commands.

## Contributor Guidance

When adding or changing npm dependencies, update the root workspace lockfile
with `npm install` from the repository root. Do not rely on nested workspace
lockfiles for Docker builds.

When adding new Docker build workflows, use:

```bash
docker build -f server/Dockerfile -t latticepolicy-api:test .
docker build -f frontend/Dockerfile -t latticepolicy-frontend:test .
```

## Validation

- YAML syntax parsed locally.
- Docker API image build.
- Docker frontend image build.
