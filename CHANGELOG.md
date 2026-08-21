# Changelog

All notable changes to LatticePolicy are documented here. This project is
pre-1.0; minor versions may still include breaking internal changes, but
release notes should call out API, migration, setup, and product-pack impact.

## [0.2.2] - 2026-08-21

### Changed

- API runtime container image now removes npm/npx after production dependency
  installation so release image scans focus on the runtime app surface rather
  than unused package-manager tooling bundled in the Node base image.
- Root and workspace package metadata are aligned on the `0.2.2` release line.

### Security

- This release follows `v0.2.1` to unblock GHCR release image publishing after
  Trivy flagged high/critical CVEs in npm CLI transitive packages inside the
  API runtime base image.
- Application dependency audit remains clean with zero unapproved
  vulnerabilities.

### Known Limitations

- LatticePolicy remains a pre-1.0 open-source framework, not a turnkey
  production PAS.
- The frontend-only Vite/plugin peer range follow-up from `v0.2.1` still
  applies.

## [0.2.1] - 2026-08-21

### Added

- Exposure management, bordereaux, reinsurance placement, ACORD/GRLC mapping,
  operational admin, data import, job queue, enterprise identity, audit replay,
  and carrier onboarding framework slices.
- Customer portal policy document listing, notification template administration,
  servicing document hooks, real document artifact rendering/storage adapters,
  and idempotency reservation locking.
- Contributor onboarding improvements, first-good-task guidance, local health
  checks, and CI troubleshooting documentation.

### Changed

- Release container builds now use the repository root lockfile and standardized
  Docker build context.
- Root and workspace package metadata are aligned on the `0.2.1` release line.
- GitHub Actions and npm dependency lines were refreshed across CI, server, and
  frontend workspaces.

### Fixed

- Cleared npm audit / Dependabot vulnerabilities across root, server, and
  frontend lockfiles.
- Fixed server Docker runtime dependency resolution so the API starts from the
  workspace path where production dependencies are installed.
- Added product fixture validation for the personal auto product pack.
- Stabilized the search error-state test.

### Security

- `npm run security:audit` reports zero unapproved vulnerabilities.
- Dependency audit, dependency review, CodeQL, container scan, DB integration,
  and Playwright E2E smoke checks are green on the release branch.

### Known Limitations

- LatticePolicy remains a pre-1.0 open-source framework, not a turnkey
  production PAS.
- The pre-existing `@vitejs/plugin-react` peer range does not yet advertise
  Vite 8 support; the project uses the documented legacy peer dependency
  install path for frontend-only lockfile maintenance until that upstream range
  catches up.
- `loadDomPurify()` is now backed by an explicit frontend dependency but remains
  unused; either wire it into PDF flows for defense in depth or remove it in a
  follow-up.
- Full production SSO, complete product governance, and production document
  artifact storage hardening remain roadmap items.

## [0.2.0] - 2026-08-03

### Added

- AI contributor process and task-note expectations for non-trivial changes.
- Carrier and reinsurance platform roadmap with GitHub label and milestone
  source files.
- Policy document generation hooks and notification intent/outbox groundwork.
- DB-backed integration coverage for migrations, policy lifecycle, quote-bind,
  customer portal security, and policy status filters.
- GitHub Actions release-readiness coverage for DB integration tests,
  Playwright E2E smoke tests, dependency audit policy, dependency review,
  CodeQL, and container scanning.
- Dependabot configuration for npm and GitHub Actions updates.
- Manual GitHub roadmap metadata sync workflow backed by repository-owned YAML.
- Release process documentation.

### Changed

- AWS ECS deployment workflow is manual-only until production AWS account,
  secrets, OIDC role, and environment approval setup are complete.
- Package metadata is updated for the `0.2.0` release line.
- Apache-2.0 license text is normalized so GitHub can recognize the repository
  license.

### Fixed

- Policy status filters now align raw DB status, derived display status, and
  expired term behavior across DB-backed and fallback paths.
- Docker and test documentation now reflect the current local validation paths.

### Security

- `npm audit` is now gated by a repository policy script.
- The current React Router advisory is tracked as an explicit temporary
  exception because LatticePolicy uses React Router as a Vite SPA client router
  and does not enable React Router RSC/framework server actions. The project
  remains on `react-router-dom` 7.18.2 because the npm-suggested downgrade
  reintroduces older high-severity advisories. Remove the exception when a
  patched non-regressing release is available.

### Known Limitations

- LatticePolicy remains a pre-1.0 open-source framework, not a turnkey
  production PAS.
- Production runtime configuration validation remains tracked separately.
- OpenAPI drift checks remain tracked separately.
- Full reinsurance, bordereaux, ACORD/GRLC mapping, production document
  artifact storage, enterprise SSO, and complete product governance remain
  roadmap items.

## [0.1.0] - 2026-06-03

### Added

- Initial open-source policy administration framework baseline.
- React/Vite operations UI and customer portal shell.
- Express/TypeScript policy API with tenant-aware quote, policy, underwriting,
  rating, admin, customer, and portal workflows.
- Product-pack and tenant configuration examples.
- Docker Compose local deployment and cloud deployment documentation.
