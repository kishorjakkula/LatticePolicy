# Open Source Readiness

This checklist tracks work needed before publishing the repository publicly.

## Completed

- Added top-level project README with quick start and architecture links.
- Added Apache-2.0 license.
- Added contribution, security, governance, and code of conduct documents.
- Added GitHub issue templates and pull request template.
- Added package metadata, repository links, issue tracker link, homepage link, and Node.js engine requirement.
- Added generated `tmpclaude-*-cwd` files to `.gitignore`.
- Removed local generated `tmpclaude-*-cwd` files from the workspace.
- Ran non-breaking `npm audit fix`.
- Split claims API/UI into a separate sibling project at `C:\JK\MVP\Claims`.
- Removed claims services from Policy workspaces, Docker Compose, production proxy routing, and public README.
- Updated root build/test scripts to run sequentially to avoid local workspace fan-out memory failures.
- Reviewed sample product, tenant, and contract seed data as synthetic/demo data.
- Kept demo credentials in local/demo-only documentation and seed flows.
- Kept all workspace packages marked `private: true`; no npm publishing is planned yet.
- Reviewed the AWS ECS deployment workflow and task templates for public repository use.
- Moved API deployment secrets in the ECS task template to ECS task secrets instead of plain environment values.
- Updated fixable security dependencies, including Sentry, Vite, React Router, and TSX package lines.
- Added CI security automation for dependency audit policy, dependency review,
  CodeQL, and container scanning.
- Added DB integration and Playwright E2E smoke jobs to CI.
- Added Dependabot configuration for npm and GitHub Actions.
- Normalized the Apache-2.0 license appendix so GitHub can recognize the
  repository license.
- Added a release-tag GHCR publishing workflow for API and frontend container
  images.

## Publishing Decisions

- Public repository: `kishorjakkula/LatticePolicy`.
- Package registry: root, frontend, server, and shared type packages remain private until a maintainer intentionally prepares an npm release.
- Container registry: publish release images to GHCR for API and frontend
  containers after release validation. Do not publish npm packages or mutable
  `latest` container tags until maintainers explicitly define those release
  policies.
- License: keep the standard Apache-2.0 `LICENSE` text. There is no `LatticePolicy contributors` placeholder in the current license file to replace.
- Sample data: product YAML files, tenant config, and contract seed SQL files are intended to be synthetic examples. Re-review them before major public announcements or when adding new samples.
- Demo credentials: `admin`, `uw1`, and `agent1` with password `password` remain local/demo-only credentials documented in developer setup. Production credentials must come from external secrets.
- AWS deployment workflow: safe to keep in the public repository as an opt-in template. It depends on repository variables, a protected `production` environment, GitHub OIDC, and external AWS secrets before it can deploy.

## Verification

Current verification:

- GitHub recognizes the repository license as Apache License 2.0 after the
  canonical `LICENSE` normalization.
- `npm audit --audit-level=high` reports 0 vulnerabilities.
- Main branch CI is green for build, frontend tests, server tests, typecheck,
  DB integration tests, Playwright E2E smoke tests, dependency audit, CodeQL,
  and container scanning.
- v0.2.3 release validation is tracked in
  `docs/tasks/issue-194-v0.2.3-release-readiness.md`.

## Before Publishing

- Re-run `npm run security:audit`, `npm run test`, `npm run typecheck`, and `npm run build` from the repository root.
- Re-run `npm run test:integration` and `npm run test:e2e:docker` before cutting a release.
- Verify a fresh clone can follow the quick-start path using `.env.example`.
- Re-review newly added sample data, task definitions, and workflow changes before publication.
- For release images, run the `Publish GHCR Images` workflow only after the
  release tag and GitHub release notes are reviewed.

## Remaining Security Work

No open npm audit exceptions are currently documented for the public-readiness
baseline. Keep running `npm run security:audit` and `npm audit` from the
repository root after dependency changes, because the project uses the root npm
workspace lockfile as the source of truth.
